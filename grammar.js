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
source_file: $ => repeat(choice($.section, $.comment)),

    // -------------------------------------------------------------------------
    // Sections
    // -------------------------------------------------------------------------
    section: $ => prec.left(seq(
      '[',
      field('name', $.section_name),
      ']',
      repeat($.section_item),
    )),

    // `extruder` / `heater_bed nozzle` / `gcode_macro MY_STARTUP` / `include extras/*.cfg`
    section_name: $ => /[A-Za-z0-9_ \-./]+/,

    // Within a section, the only legal items are settings and
    // comments. We use `seq(repeat(setting_or_comment))` so the
    // parser does not have to choose between a single setting
    // and a single comment at each position.
    section_item: $ => choice(
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
    setting: $ => seq(
      field('key', $.setting_key),
      optional(/[ \t]+/),
      field('separator', $.setting_separator),
      field('value', $.value_text),
    ),

    setting_key: $ => /[A-Za-z_][A-Za-z0-9_.-]*/,
    setting_separator: $ => /[=:]/,

    // Value: any non-empty run of non-newline characters. This
    // includes `#`/`;` (so `host: mqtt://broker#1883` and
    // `key: value # comment` both produce a single value token).
    // tree-sitter cannot distinguish inline comments from `#nospace`
    // value without an external scanner; see the implementation
    // note at the top.
    value_text: $ => /[^\n\r]+/,

    // -------------------------------------------------------------------------
    // gcode: blocks
    // -------------------------------------------------------------------------
    // A `gcode:` setting is structurally different: the key is a literal
    // `gcode` and the body is zero or more indented continuation lines
    // that mix Jinja, G-code, and `#`/`;` line comments. The grammar is
    // deliberately forgiving: anything that doesn't fit a specific token
    // becomes `gcode_text`, so unknown Klipper commands never cause
    // parse errors.
    //
    // ponytail: the regex fallback (`gcode_text` is restricted so it
    // cannot outbid `gcode_word`) is the cheapest way to make the lexer
    // pick the right token; an external scanner would be more correct
    // but is overkill for a configuration grammar.
    gcode_block: $ => seq(
      'gcode',
      field('separator', $.setting_separator),
      // Optional first-line value (e.g. `gcode: M104 S0`).
      field('first_line', optional(seq(
        token.immediate(/[ \t]+/),
        $.gcode_line_content,
      ))),
      // Zero or more indented continuation lines (real or blank).
      repeat($.gcode_line),
    ),

// One indented continuation line. Newline + leading whitespace + content.
// `token(prec(1, /\n[ \t]+/))` ensures the newline is consumed by this
// rule rather than being silently skipped by the `\s` extras pattern.
gcode_line: $ => seq(
  token(prec(1, /\n[ \t]+/)),
  optional($.gcode_line_content),
),

    // A line's content is a flat sequence of tokens. Specific tokens
    // (Jinja, line comments) win via precedence; the rest falls back
    // to `gcode_text` so unknown identifiers never break the parse.
    gcode_line_content: $ => seq(
      choice(
        alias(token.immediate(prec(2, /\{%[^}%]*%\}/)), $.jinja_tag),
        alias(token.immediate(prec(2, /\{\{[^}]*\}\}/)), $.jinja_expression),
        alias(token.immediate(prec(2, /\{#[\s\S]*?#\}/)), $.jinja_comment),
        alias(token.immediate(prec(2, /\{action_[a-z_]+\([^}]*\)\}/)), $.klipper_action),
        alias(token.immediate(prec(3, /[#;][^\n]*/)), $.gcode_line_comment),
        // gcode_word prec 2 so it outbids gcode_text on length ties
        // (e.g. `=1.0` vs `1.0`); otherwise the greedy text fallback
        // eats the numeric value. Quoted strings are included so
        // RESPOND MSG="hello" parses as word + text + word + text + word.
        alias(token.immediate(prec(3, /[A-Z][A-Z0-9_]*|[0-9]+(\.[0-9]+)?|"[^"\n]*"/)), $.gcode_word),
        alias(token.immediate(prec(1, /[ \t]+|[^A-Z{#;%\s\n0-9][^A-Z0-9\n]*/)), $.gcode_text),
      ),
      repeat(choice(
        alias(token.immediate(prec(2, /\{%[^}%]*%\}/)), $.jinja_tag),
        alias(token.immediate(prec(2, /\{\{[^}]*\}\}/)), $.jinja_expression),
        alias(token.immediate(prec(2, /\{#[\s\S]*?#\}/)), $.jinja_comment),
        alias(token.immediate(prec(2, /\{action_[a-z_]+\([^}]*\)\}/)), $.klipper_action),
        alias(token.immediate(prec(3, /[#;][^\n]*/)), $.gcode_line_comment),
        alias(token.immediate(prec(3, /[A-Z][A-Z0-9_]*|[0-9]+(\.[0-9]+)?|"[^"\n]*"/)), $.gcode_word),
        alias(token.immediate(prec(1, /[ \t]+|[^A-Z{#;%\s\n0-9][^A-Z0-9\n]*/)), $.gcode_text),
      )),
    ),

    // Jinja constructs. prec(2) so they beat `gcode_word` / `gcode_text`
    // when the strings overlap (e.g. `{{foo}}` vs an identifier fallback).
    jinja_tag: $ => token(prec(2, /\{%[^}%]*%\}/)),
    jinja_expression: $ => token(prec(2, /\{\{[^}]*\}\}/)),
    jinja_comment: $ => token(prec(2, /\{#[\s\S]*?#\}/)),
    // Klipper inline action calls: `{action_raise_error("...")}`,
    // `{action_respond_info('...')}`. These are not Jinja but
    // use the same single-brace syntax; treat them as Jinja so
    // they don't crash the parser on real configs.
    klipper_action: $ => token(prec(2, /\{action_[a-z_]+\([^}]*\)\}/)),

    gcode_line_comment: $ => token(prec(3, /[#;][^\n]*/)),

    // G-code command or parameter identifier, including numeric values.
    gcode_word: $ => token(prec(1, /[A-Z][A-Z0-9_]*|[0-9]+(\.[0-9]+)?/)),

    // Fallback for anything that isn't a token above.
    gcode_text: $ => token(prec(1, /[ \t]+|[^A-Z{#;%\s\n][^A-Z\n]*/)),

    // -------------------------------------------------------------------------
    // Comments
    // -------------------------------------------------------------------------
    // Full-line comments start at column 0 (or after only whitespace) with
    // `#` or `;`. SAVE_CONFIG lines are a series of `#*#`-prefixed lines
    // captured as a single node with a distinct type so the highlights
    // query can colour it differently.
    comment: $ => choice(
      $.save_config_line,
      $.line_comment,
    ),

    // Wrap as a token so the parser, not the lexer, picks when to
    // start a comment: this lets `; semi` inside a section become a
    // `section_item` rather than a top-level `comment` that closes
    // the section prematurely (regression on klipper_main #18).
    line_comment: $ => token(/[#;][^\n]*/),

    // SAVE_CONFIG block: `prec(1)` so that `#*# ...` is preferred
    // over `# ...` when both regexes match.
    save_config_line: $ => token(prec(1, /#\*#[^\n]*/)),
  },
});