# AGENTS.md — operating manual for AI coding agents

This file is for coding agents. Human-facing documentation lives in
[`README.md`](README.md).

## Project overview

`tree-sitter-klipper` is a tree-sitter grammar for Klipper 3D-printer
configuration files. It is used by the
[zed-klipper](https://github.com/dmitry-sorkin/zed-klipper) Zed extension.

## Repository layout

- `grammar.js` — grammar source; edit this file when changing syntax
- `src/` — generated parser sources
- `test/corpus/` — 33 corpus tests
- `bindings/` — language bindings
- `build/` — generated build artefacts; gitignored

## Grammar development

Match the existing `grammar.js` style: CommonJS, two-space indentation, no
semicolons, and JSDoc on rules.

```sh
tree-sitter generate
tree-sitter test
```

Edit `grammar.js`, regenerate the parser, then run the complete corpus suite.
Use Conventional Commits for commit messages.

To build WebAssembly locally:

```sh
tree-sitter build --wasm
```

This requires `emcc`. CI may skip the local WASM build because zed-klipper
builds the grammar during extension installation.

## Release flow

1. Commit ready `grammar.js` and generated parser changes.
2. Push the commit to `main`.
3. Update the commit pin in
   [`dmitry-sorkin/zed-klipper`](https://github.com/dmitry-sorkin/zed-klipper)'s
   `extension.toml`.

zed-klipper handles the WASM rebuild.
