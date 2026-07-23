package tree_sitter_klipper_test

import (
	"testing"

	tree_sitter "github.com/tree-sitter/go-tree-sitter"
	tree_sitter_klipper "github.com/dsorkin/tree-sitter-klipper/bindings/go"
)

func TestCanLoadGrammar(t *testing.T) {
	language := tree_sitter.NewLanguage(tree_sitter_klipper.Language())
	if language == nil {
		t.Errorf("Error loading Klipper grammar")
	}
}
