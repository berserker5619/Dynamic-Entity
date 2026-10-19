# sheet-to-schema's fixtures

Every CSV, TSV and `.xlsx` fixture in sheet-to-schema's `test/fixtures`, copied byte for byte from its `v1.3.0` tag (`git show v1.3.0:test/fixtures/<dir>/<file>`), named `<dir>__<file>`. Dynamic Entity 3.1's acceptance criteria hold its browser readers to the server over these files (docs/3.1-spec.md, A). Kept as `-text` in `.gitattributes`, so CRLF line ends stay as Excel wrote them.

| File | SHA-256 |
| --- | --- |
| `order__sample.csv` | `32a8090079a16c2e0133d1e3bedca8f915953e2b03c5e5e959afd9f2d8e39958` |
| `parity__blank_lines.csv` | `2a5f6074ff6979b29474f58c50059f1e95808d64b9e98cf6164395a76333b1ea` |
| `parity__blank_rows.xlsx` | `0d2b52f5893f75e9c86b46245cd292cfa84fd86740ebbea10d1499c4344b8d8b` |
| `parity__error_cells.xlsx` | `5eb1c3aa7ec4bc478b1a15decf3eaf4ac3a046ad5413e63e3b3d706e8cf3e56c` |
| `parity__formula_results.xlsx` | `4aaee92e036a99943c8ed3fce806ef99b0da882520c25013e28884bc705688ba` |
| `parity__header_commas.tsv` | `847d8a73c6ea6ca55e84131271a1aa26771db92605cec959eba36865de4f947b` |
| `parity__ragged_rows.csv` | `30bde4be2e342a742bf9d93d36e4be82b9d4dc909d0ac3a35e7c29aee6333770` |
| `parity__tamil_text.xlsx` | `02689af8c38ef5441fbc1649a133981cd50d39371459cce9ac7b56710f3a1887` |
| `parity__typed_cells.xlsx` | `51c96300a822492d4fb42303777e37a14e4b6d74b2105453bbf103ca4572261d` |
| `real-world__case1_1904_dates.xlsx` | `dd735b2a7a10cecdf11906a049e23c623b7e06beac549e53478731ebc8cacf7e` |
| `real-world__case2_numeric_identifiers.xlsx` | `9187ebb1d57d8eb300a82222699bd797ad67fd6a6fb5554785ae3283b3486b94` |
| `real-world__case3_excel_semicolon.csv` | `e966386c077a6afccee39931eefd35cd9aec38b166d85d9f3953215895d72c5c` |
| `real-world__case3_excel_utf8_bom.csv` | `a95963a619aa141d686460630e0396cef728629aacd1b541e63bb5bba4aac404` |
| `real-world__case3_google_sheets.csv` | `1fa5d892da4f77101da4fc79133b67c0fb6e6a3994913e6ec14f6cdc69527d27` |
| `real-world__case4_complex_sheet.xlsx` | `2a0f52e78e155c1dadbc2a95135393e6438607e48bfea920b56d7cc51236a040` |
| `real-world__case5_non_latin.csv` | `4e76770cf5453a516cdcc78591b6bccf133e593562fd4e658e434ea10c943faa` |
| `real-world__case5_non_latin.xlsx` | `1fde67b5c599f53501b6d32f44dd63ce9b4a1f9f451603fc6b4c829706297801` |
| `student__sample.csv` | `c85e43fceeecf73f7f2390a56c71445a553fd85f2920990e2fcb03a50e2aaf4b` |
