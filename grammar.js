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
    section_name: $ => /[A-Za-z0-9_ \-\.\/]+/,

    // Within a section, the only legal items are settings and
    // comments. We use `seq(repeat(setting_or_comment))` so the
    // parser does not have to choose between a single setting
    // and a single comment at each position.
    section_item: $ => choice(
      $.setting,
      $.line_comment,
      $.save_config_line,
    ),

    // -------------------------------------------------------------------------
    // Settings
    // -------------------------------------------------------------------------
    // A `key: value` line has the same shape as `key = value`, with `=`
    // or `:` as the separator.
    setting: $ => seq(
      field('key', $.setting_key),
      field('separator', $.setting_separator),
      field('value', $.value_text),
    ),

    setting_key: $ => /[A-Za-z_][A-Za-z0-9_.\-]*/,
    setting_separator: $ => /[=:]/,

    // Value: any non-empty run of non-newline characters. This
    // includes `#`/`;` (so `host: mqtt://broker#1883` and
    // `key: value # comment` both produce a single value token).
    // tree-sitter cannot distinguish inline comments from `#nospace`
    // value without an external scanner; see the implementation
    // note at the top.
    value_text: $ => /[^\n\r]+/,

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

    line_comment: $ => /[#;][^\n]*/,

    // SAVE_CONFIG block: `prec(1)` so that `#*# ...` is preferred
    // over `# ...` when both regexes match.
    save_config_line: $ => token(prec(1, /#\*#[^\n]*/)),
  },
});
