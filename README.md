# tree-sitter-klipper

A [tree-sitter](https://tree-sitter.github.io/) grammar for
[Klipper](https://www.klipper3d.org/) `.cfg` configuration files —
sections, settings, values, comments, and the auto-written
`SAVE_CONFIG` block.

Used by the [zed-klipper](https://github.com/dmitry-sorkin/zed-klipper)
Zed editor extension. Zed clones this repo at install time and
compiles the WASM grammar itself; no prebuilt artifact is shipped.

Derived from
[fluidd-core/fluidd](https://github.com/fluidd-core/fluidd)'s
Monarch highlighter and therefore licensed under **GPL-3.0 or later**.

## Development

```sh
tree-sitter generate   # rebuild parser.c, grammar.json, node-types.json
tree-sitter test       # run the corpus tests
```

Requires `tree-sitter` CLI >= 0.22 (`cargo install tree-sitter-cli`
or `npm install -g tree-sitter-cli`).
