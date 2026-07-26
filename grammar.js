/**
 * @file Klipper grammar for tree-sitter
 * @author Dmitry Sorkin <dsorkin@localhost>
 * @license GPL-3.0
 *
 * Behaviour follows CPython's `configparser.RawConfigParser(
 *   strict=False,
 *   inline_comment_prefixes=(';', '#')
 * )`, which is exactly what Fluidd's `klippy/extras/configfile.py` uses
 * (see `src/monaco/language/klipper-config.monarch.ts` in
 * fluidd-core/fluidd for the equivalent Monarch definition).
 *
 * Concretely:
 *   - Sections look like `[name]` or `[name arg]` and must not be indented.
 *   - Settings are `key = value` or `key: value` inside a section.
 *   - A `#` or `;` starts a comment only when it is the first non-whitespace
 *     character on the line OR is preceded by whitespace on the same line.
 *     Otherwise it is part of the value.
 *   - `#*#` is Klipper's SAVE_CONFIG auto-written block marker.
 *   - A setting whose key is `gcode` may span multiple indented continuation
 *     lines. The body mixes Jinja (`{% ... %}`, `{{ ... }}`, `{# ... #}`),
 *     G-code commands (G1, M104, ...) and Klipper extended commands
 *     (SET_FAN_SPEED, RESPOND, M118, ...), parameters (X100, S200,
 *     SPEED=1.0), and `#`/`;` line comments.
 *
 * Implementation note
 * -------------------
 * The value-vs-inline-comment distinction is a `configparser`
 * backtracking state machine in Klipper itself: the `#`/`;` token
 * is a comment separator only when it's preceded by whitespace,
 * otherwise it's part of the value. tree-sitter's GLR cannot
 * backtrack across whitespace (which is in `extras`), and `prec`
 * on tokens only resolves equal-length matches. We therefore
 * collapse `key: value # comment` and `key: value#nospace` into
 * a single value token. The highlights query can still highlight
 * a `#`/`;` substring at the end of a value differently from
 * the rest of the value if the theme supports it.
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

module.exports = grammar({
	name: "klipper",

	rules: {
		// Top-level: a file is a sequence of either sections or comments.
		// Settings are only valid inside a section.
		source_file: ($) => repeat(choice($.section, $.comment)),

		// -------------------------------------------------------------------------
		// Sections
		// -------------------------------------------------------------------------
		section: ($) =>
			prec.left(
				seq(
					"[",
					field("type", $.section_type),
					optional(seq(token.immediate(/[ \t]+/), field("name", $.section_name))),
					"]",
					repeat($.section_item),
				),
			),

		section_type: ($) => token(/[A-Za-z_][A-Za-z0-9_]*/),

		// `extruder` / `heater_bed nozzle` / `gcode_macro MY_STARTUP` / `include extras/*.cfg`
		section_name: ($) => /[A-Za-z0-9_ \-./]+/,

		// Within a section, the only legal items are settings and
		// comments. We use `seq(repeat(setting_or_comment))` so the
		// parser does not have to choose between a single setting
		// and a single comment at each position.
		section_item: ($) =>
			choice(
				// `gcode:` blocks are tried first via prec.dynamic(1) so the
				// multi-line body wins against the plain `setting` rule when
				// the key is `gcode`.
				prec.dynamic(1, $.gcode_block),
				$.setting,
				// In-section comments appear as `comment` in the AST via the
				// alias trick: tree-sitter sees the rule literally distinct
				// from top-level `comment` so the in-section form wins.
				alias($.line_comment, $.comment),
				$.save_config_line,
			),

		// -------------------------------------------------------------------------
		// Settings
		// -------------------------------------------------------------------------
		// A `key: value` line has the same shape as `key = value`, with `=`
		// or `:` as the separator.
		setting: ($) =>
			seq(
				field("key", $.setting_key),
				optional(/[ \t]+/),
				field("separator", $.setting_separator),
				field("value", $.value_text),
			),

		setting_key: ($) => /[A-Za-z_][A-Za-z0-9_.-]*/,
		setting_separator: ($) => /[=:]/,

		// Value: any non-empty run of non-newline characters. This
		// includes `#`/`;` (so `host: mqtt://broker#1883` and
		// `key: value # comment` both produce a single value token).
		// tree-sitter cannot distinguish inline comments from `#nospace`
		// value without an external scanner; see the implementation
		// note at the top.
		value_text: ($) => /[^\n\r]+/,

		// -------------------------------------------------------------------------
		// gcode: blocks
		// -------------------------------------------------------------------------
		// A `gcode:` setting is structurally different: the key is one of
		// `gcode`, `activate_gcode`, `deactivate_gcode`, `start_gcode`,
		// `end_gcode` and the body is zero or more indented continuation
		// lines that mix Jinja, G-code, and `#`/`;` line comments. The
		// grammar is deliberately forgiving: anything that doesn't fit a
		// specific token becomes `gcode_text`, so unknown Klipper commands
		// never cause parse errors.
		//
		// ponytail: the regex fallback (`gcode_text` is restricted so it
		// cannot outbid `gcode_word`) is the cheapest way to make the lexer
		// pick the right token; an external scanner would be more correct
		// but is overkill for a configuration grammar.
		// ponytail: `token(prec(1, /.../))` ensures the gcode key outranks
		// the broader `setting_key` regex so the multi-line body wins.
		gcode_block: ($) =>
			seq(
				token(prec(1, /[a-z_]*gcode/)),
				field("separator", $.setting_separator),
				// Optional first-line value (e.g. `gcode: M104 S0`).
				field(
					"first_line",
					optional(seq(token.immediate(/[ \t]+/), $.gcode_line_content)),
				),
				// Zero or more indented continuation lines (real or blank).
				repeat($.gcode_line),
			),

		// One indented continuation line. Newline + leading whitespace + content.
		// `token(prec(1, /\n[ \t]+/))` ensures the newline is consumed by this
		// rule rather than being silently skipped by the `\s` extras pattern.
		gcode_line: ($) =>
			seq(token(prec(1, /\n[ \t]+/)), optional($.gcode_line_content)),

		// A line's content is a flat sequence of tokens. Specific tokens
		// (Jinja, line comments) win via precedence; the rest falls back
		// to `gcode_text` so unknown identifiers never break the parse.
		// The FIRST token on the line is the actual command (G1, M104,
		// SET_FAN_SPEED, RESPOND, ...); later `gcode_command` tokens
		// are argument names (SPEED, MSG, LOG, ...). The first choice
		// below exposes that distinction via the `command` field on the
		// first `gcode_command`; the repeat() below keeps argument-name
		// tokens plain so highlights can colour them differently.
		gcode_line_content: ($) =>
			seq(
				choice(
					$.jinja_tag,
					$.jinja_expression,
					$.jinja_comment,
					$.klipper_action,
					$.jinja_bare_expression,
					alias(token.immediate(prec(3, /[#;][^\n]*/)), $.gcode_line_comment),
					field(
						"command",
						alias(
							token.immediate(
								prec(
									20,
									/[GM][0-9]+(\.[0-9]+)?|[A-Z][A-Z0-9_]*[A-Z_][A-Z0-9_]*/,
								),
							),
							$.gcode_command_name,
						),
					),
					alias(
						token.immediate(prec(10, /[A-Z][0-9]*\.?[0-9]*/)),
						$.gcode_parameter,
					),
					alias(token.immediate(prec(2, /[0-9]+(\.[0-9]+)?/)), $.gcode_number),
					alias(
						token.immediate(prec(2, /"[^"\n]*"|'[^'\n]*'/)),
						$.gcode_string,
					),
					$.gcode_identifier,
					seq(
						token.immediate(prec(3, /=/)),
						choice(
							$.gcode_identifier,
							$.gcode_number,
							$.gcode_string,
							$.gcode_command,
							$.gcode_parameter,
							$.gcode_text,
						),
					),
					alias(
						token.immediate(
							prec(
								1,
								/[ \t]+|[^A-Z{#;%\s\n0-9"'][^A-Z0-9\n"']*|\{[ \t][^}\n]*\}/,
							),
						),
						$.gcode_text,
					),
				),
				repeat(
					choice(
						$.jinja_tag,
						$.jinja_expression,
						$.jinja_comment,
						$.klipper_action,
						$.jinja_bare_expression,
						alias(token.immediate(prec(3, /[#;][^\n]*/)), $.gcode_line_comment),
						alias(
							token.immediate(
								prec(
									20,
									/[GM][0-9]+(\.[0-9]+)?|[A-Z][A-Z0-9_]*[A-Z_][A-Z0-9_]*/,
								),
							),
							$.gcode_command,
						),
						alias(
							token.immediate(prec(10, /[A-Z][0-9]*\.?[0-9]*/)),
							$.gcode_parameter,
						),
						alias(
							token.immediate(prec(2, /[0-9]+(\.[0-9]+)?/)),
							$.gcode_number,
						),
						alias(
							token.immediate(prec(2, /"[^"\n]*"|'[^'\n]*'/)),
							$.gcode_string,
						),
						$.gcode_identifier,
						seq(
							token.immediate(prec(3, /=/)),
							choice(
								$.gcode_identifier,
								$.gcode_number,
								$.gcode_string,
								$.gcode_command,
								$.gcode_parameter,
								$.gcode_text,
							),
						),
						alias(
							token.immediate(
								prec(
									1,
									/[ \t]+|[^A-Z{#;%\s\n0-9"'][^A-Z0-9\n"']*|\{[ \t][^}\n]*\}/,
								),
							),
							$.gcode_text,
						),
					),
				),
			),

		// Jinja constructs. Structural nodes expose their contents for
		// fine-grained highlighting.
		jinja_tag: ($) =>
			seq(
				token.immediate("{%"),
				optional($.jinja_content),
				token(prec(2, "%}")),
			),
		jinja_expression: ($) =>
			seq(token.immediate("{{"), optional($.jinja_content), "}}"),
		jinja_bare_expression: ($) =>
			seq(token.immediate("{"), optional($.jinja_content), "}"),
		jinja_content: ($) =>
			repeat1(
				choice(
					$.jinja_keyword,
					$.jinja_builtin,
					$.jinja_string,
					$.jinja_number,
					$.jinja_operator,
					$.jinja_bracket,
					$.jinja_variable,
				),
			),
		jinja_keyword: ($) =>
			token(
				prec(
					3,
					/(if|elif|else|endif|for|endfor|set|not|and|or|is|true|True|false|False)[^A-Za-z0-9_]/,
				),
			),
		jinja_builtin: ($) =>
			choice(
				token(
					prec(
						2,
						/(default|int|float|string|list|dict|abs|max|min|sum|length|count|sort|reverse|map|join|upper|lower|capitalize|title|replace|trim|truncate|striptags|escape|safe|forceescape|attr|batch|groupby|select|reject|selectattr|rejectattr|items|pprint|urlencode|wordcount|wordwrap|filesizeformat|indent|center|first|last|slice|random|in|none|None|range|defined|undefined|even|odd|divisibleby|iterable|mapping|number|sequence|callable|test|sameas)[^A-Za-z0-9_{}]/,
					),
				),
				token(
					prec(
						1,
						/(default|int|float|string|list|dict|abs|max|min|sum|length|count|sort|reverse|map|join|upper|lower|capitalize|title|replace|trim|truncate|striptags|escape|safe|forceescape|attr|batch|groupby|select|reject|selectattr|rejectattr|items|pprint|urlencode|wordcount|wordwrap|filesizeformat|indent|center|first|last|slice|random|in|none|None|range|defined|undefined|even|odd|divisibleby|iterable|mapping|number|sequence|callable|test|sameas)/,
					),
				),
			),
		jinja_string: ($) => token(prec(2, /'[^'\n]*'|"[^"\n]*"/)),
		jinja_number: ($) => token(prec(2, /[0-9]+(\.[0-9]+)?/)),
		jinja_operator: ($) => token(prec(1, /[|=+\-*<>!%.:_]+/)),
		jinja_bracket: ($) => token(prec(1, /\(|\)|\[|\]/)),
		jinja_variable: ($) => token(prec(1, /[A-Za-z_][A-Za-z0-9_]*/)),
		jinja_comment: ($) => token.immediate(prec(2, /\{#[\s\S]*?#\}/)),
		// Klipper inline action calls: `{action_raise_error("...")}`,
		// `{action_respond_info('...')}`. Expose the action name and args
		// so strings can be highlighted independently.
		klipper_action: ($) =>
			seq(
				token.immediate("{"),
				field("name", $.klipper_action_name),
				token(prec(2, "(")),
				repeat(
					choice(
						$.jinja_string,
						$.jinja_number,
						$.jinja_variable,
						$.jinja_operator,
					),
				),
				token(prec(2, ")")),
				"}",
			),
		klipper_action_name: ($) => token(prec(20, /action_[a-z_]+/)),

		gcode_line_comment: ($) => token(prec(3, /[#;][^\n]*/)),

		gcode_command_name: ($) =>
			token(prec(3, /[GM][0-9]+(\.[0-9]+)?|[A-Z][A-Z0-9_]*[A-Z_][A-Z0-9_]*/)),
		gcode_command: ($) =>
			token(prec(3, /[GM][0-9]+(\.[0-9]+)?|[A-Z][A-Z0-9_]*[A-Z_][A-Z0-9_]*/)),
		gcode_parameter: ($) => token(prec(10, /[A-Z][0-9]*\.?[0-9]*/)),
		gcode_number: ($) => token(prec(2, /[0-9]+(\.[0-9]+)?/)),
		gcode_string: ($) => token(prec(2, /"[^"\n]*"|'[^'\n]*'/)),
		gcode_identifier: ($) => token(prec(2, /[a-z_][a-zA-Z0-9_.]*/)),

		// Fallback for anything that isn't a token above.
		gcode_text: ($) =>
			token(
				prec(1, /[ \t]+|[^A-Z{#;%\s\n0-9"'][^A-Z0-9\n"']*|\{[ \t][^}\n]*\}/),
			),

		// -------------------------------------------------------------------------
		// Comments
		// -------------------------------------------------------------------------
		// Full-line comments start at column 0 (or after only whitespace) with
		// `#` or `;`. SAVE_CONFIG lines are a series of `#*#`-prefixed lines
		// captured as a single node with a distinct type so the highlights
		// query can colour it differently.
		comment: ($) => choice($.save_config_line, $.line_comment),

		// Wrap as a token so the parser, not the lexer, picks when to
		// start a comment: this lets `; semi` inside a section become a
		// `section_item` rather than a top-level `comment` that closes
		// the section prematurely (regression on klipper_main #18).
		line_comment: ($) => token(/[#;][^\n]*/),

		// SAVE_CONFIG block: `prec(1)` so that `#*# ...` is preferred
		// over `# ...` when both regexes match.
		save_config_line: ($) => token(prec(1, /#\*#[^\n]*/)),
	},
});
