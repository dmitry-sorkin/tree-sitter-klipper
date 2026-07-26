# tree-sitter-klipper

[![ grammar ](https://img.shields.io/badge/tree--sitter-grammar-blue)](https://tree-sitter.github.io/tree-sitter/)

A [tree-sitter](https://tree-sitter.github.io/tree-sitter/) grammar for
[Klipper](https://www.klipper3d.org/) 3D-printer configuration files.

It is used by the [zed-klipper](https://github.com/dmitry-sorkin/zed-klipper)
Zed editor extension. It can also be used with Neovim through
[nvim-treesitter](https://github.com/nvim-treesitter/nvim-treesitter).

## What it parses

- Section headers such as `[stepper_x]` and `[bltouch name]`
- Settings such as `key: value`, including optional values, comma-separated
  multi-values, and inline trailing comments
- `gcode:` bodies containing Jinja statements (`{% ... %}`), expressions
  (`{{ ... }}`), comments (`{# ... #}`), bare inline expressions (`{...}`),
  G-code commands, Klipper commands, and line comments

## Known limitations

The grammar targets tree-sitter 0.25's regex engine. It does not support
lookahead, and non-greedy regexes do not work as needed here; the grammar uses
GLR conflicts and rule structure instead.

- A `;` as the first item in a section closes that section because of an LR
  tie.
- `value#nospace` remains one token; a comment marker needs the grammar's
  expected spacing.

## Development

Requires the tree-sitter CLI (>= 0.25 recommended):

```sh
tree-sitter generate   # regenerate src/parser.c and grammar metadata
tree-sitter test       # run the corpus tests
```

Edit `grammar.js`, run `tree-sitter generate`, and run `tree-sitter test`
before committing. To build the optional WASM artefact locally, run
`tree-sitter build --wasm` with `emcc` installed. The zed-klipper extension
rebuilds WASM during installation.

## Licence

GPL-3.0, inherited from
[Fluidd](https://github.com/fluidd-core/fluidd).
