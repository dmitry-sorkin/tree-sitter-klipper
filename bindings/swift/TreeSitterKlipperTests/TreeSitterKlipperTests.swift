import XCTest
import SwiftTreeSitter
import TreeSitterKlipper

final class TreeSitterKlipperTests: XCTestCase {
    func testCanLoadGrammar() throws {
        let parser = Parser()
        let language = Language(language: tree_sitter_klipper())
        XCTAssertNoThrow(try parser.setLanguage(language),
                         "Error loading Klipper grammar")
    }
}
