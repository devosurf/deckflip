# Question

How are fonts embedded in PPTX (part types, obfuscation/EOT, embeddable-permission bits), which PowerPoint versions on Windows and Mac honour embedded fonts, what is the set of fonts safe to assume on both platforms, and how can a Node process enumerate locally installed fonts and their files for layout and embedding?

# Findings

## 1) How PPTX font embedding is structured

- PowerPoint’s embedded-font metadata lives in `p:embeddedFontLst` in `ppt/presentation.xml`. Microsoft’s Open XML docs say the list contains `p:embeddedFont` entries, that each embedded font typeface must be unique, and that PowerPoint further requires every listed font to actually be used in the presentation. Source: [MS-OE376 embeddedFontLst](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oe376/e3870782-1f40-4ef1-a3a8-01ee13661283), [EmbeddedFontList SDK docs](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.presentation.embeddedfontlist?view=openxml-3.0.1).

- The actual embedded font payload is stored in a separate font part. Microsoft’s PowerPoint/Open XML spec says PowerPoint stores TrueType/OpenType fonts in parts with content type `application/x-fontdata`; MS-OE376’s bibliography points to EOT and MTX references for that payload, so it should be treated as a PowerPoint font-data container that may be EOT/MTX-wrapped rather than bare raw sfnt data. This is different from OOXML’s font-obfuscation algorithm in ECMA-376 Part 4 §2.8.1, which applies to WordprocessingML only. So for PPTX, treat embedded font payloads as PowerPoint font-data parts, not as Word-style obfuscated-font parts. Sources: [MS-OI29500 Font Part](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oi29500/ea097c57-5794-4624-b08e-017b47051b1d), [ECMA-376 Font Embedding](https://c-rex.net/samples/ooxml/e1/Part4/OOXML_P4_DOCX_Font_topic_ID0ERNCU.html), [EOT](https://www.w3.org/submissions/EOT/), [MTX](https://www.w3.org/submissions/MTX/), [FontPart SDK docs](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.packaging.fontpart?view=openxml-3.0.1).

- The licensing gate is the font’s `OS/2.fsType` field. Microsoft’s OpenType spec says the permissions bits are: `0` installable embedding, `2` restricted license embedding, `4` preview & print embedding, `8` editable embedding; `0x0100` means no subsetting and `0x0200` means bitmap embedding only. For OpenType OS/2 version 3+, bits 0–3 are mutually exclusive; for versions 0–2, Microsoft notes some fonts historically set multiple bits and applications may honor the least restrictive permission. Source: [OS/2 fsType spec](https://learn.microsoft.com/en-us/typography/opentype/spec/os2), [Win32 embedded fonts overview](https://learn.microsoft.com/en-us/windows/win32/gdi/embedded-fonts).

- Microsoft also states that if a document uses Preview & Print or Editable embedded fonts, those temporary embedded fonts must be deleted when the document is closed. Source: [OS/2 fsType spec](https://learn.microsoft.com/en-us/typography/opentype/spec/os2), [Win32 embedded fonts overview](https://learn.microsoft.com/en-us/windows/win32/gdi/embedded-fonts).

## 2) Which PowerPoint versions honour embedded fonts

- Microsoft’s current support article for embedding custom fonts applies to PowerPoint for Microsoft 365, PowerPoint 2024, PowerPoint 2021, PowerPoint 2019, and PowerPoint 2016 on Windows, and to PowerPoint for Microsoft 365 for Mac, PowerPoint 2024 for Mac, and PowerPoint 2021 for Mac on macOS. That is the narrowest first-party matrix I could confirm. Source: [Benefits of embedding custom fonts](https://support.microsoft.com/en-us/office/fonts/benefits-of-embedding-custom-fonts).

- The same Microsoft article documents the user-facing save path: `File > Options > Save > Embed fonts in the file`, with the two PowerPoint choices `Embed only the characters used in the presentation` and `Embed all characters (best for editing by other people)`. Source: [Benefits of embedding custom fonts](https://support.microsoft.com/en-us/office/fonts/benefits-of-embedding-custom-fonts).

- [INFERENCE] Practical read: the desktop PowerPoint versions above are the ones Microsoft documents as supporting embedded-font saving; PowerPoint for the web is not part of that save/embedding surface. I did not find a first-party page that expands the Mac support back to 2016/2019 for embedding, so I am not claiming that. Source basis: [Benefits of embedding custom fonts](https://support.microsoft.com/en-us/office/fonts/benefits-of-embedding-custom-fonts).

## 3) Safe fonts to assume on both Windows and macOS

Conservative cross-platform safe set from the overlap of Microsoft’s shipped Windows font list and Apple’s macOS system-font list:

- Arial
- Courier New
- Georgia
- Times New Roman
- Trebuchet MS
- Verdana

Microsoft’s Windows 11 font list includes all six families; Apple’s System Fonts directory lists the same families on macOS. Sources: [Windows 11 font list](https://learn.microsoft.com/en-us/typography/fonts/windows_11_font_list), [Apple System Fonts](https://developer.apple.com/fonts/system-fonts/?q=monaco).

This is a conservative baseline, not an exhaustive overlap of every shared family that may exist on both platforms. For a PowerPoint authoring pipeline, these six are the safest assumption when you want to avoid font substitution without embedding.

## 4) How a Node process can enumerate fonts and resolve files

### macOS

- CoreText can enumerate all available fonts with `CTFontCollectionCreateFromAvailableFonts(_)`; Apple says it returns “a new collection containing all fonts available to the current application.” Source: [Apple CoreText docs](https://developer.apple.com/documentation/coretext/ctfontcollectioncreatefromavailablefonts%28_%3A%29).

- A font descriptor can expose the underlying file URL via `kCTFontURLAttribute`, whose value is a `CFURL`. Apple’s `CTFontDescriptorCopyAttribute` API returns arbitrary descriptor attributes, and the `kCTFontURLAttribute` docs identify it as the font URL from the descriptor. Source: [kCTFontURLAttribute](https://developer.apple.com/documentation/coretext/kctfonturlattribute), [CTFontDescriptorCopyAttribute](https://developer.apple.com/documentation/coretext/ctfontdescriptorcopyattribute%28_%3A_%3A%29).

- The `fontmanager-redux` package uses exactly that CoreText path: `CTFontCollectionCreateFromAvailableFonts` / `CTFontCollectionCreateMatchingFontDescriptors` to enumerate, and `kCTFontURLAttribute` to resolve file paths. Source: [fontmanager-redux Mac backend](https://raw.githubusercontent.com/Eugeny/fontmanager-redux/master/src/FontManagerMac.mm).

- The `font-list` package’s macOS backend is different: it shells out to a compiled helper or falls back to `system_profiler SPFontsDataType`, which returns family names but not the same rich file-path metadata as CoreText. Source: [font-list mac backend](https://raw.githubusercontent.com/oldj/node-font-list/master/libs/darwin/index.js).

### Windows

- Microsoft’s DirectWrite docs show the canonical enumeration path: `GetSystemFontCollection()` → `GetFontFamilyCount()` → `GetFontFamily()` → `GetFamilyNames()`. Source: [How to Enumerate Fonts](https://learn.microsoft.com/en-us/windows/win32/directwrite/font-enumeration).

- Microsoft’s GDI docs also say an app can retrieve installed font names with `EnumFontFamilies` / `ChooseFont`. For file resolution, the font registry key `HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts` maps display names to file names, and per-user installs may also exist under `HKEY_CURRENT_USER\...\Fonts`. Source: [Font Installation and Deletion](https://learn.microsoft.com/en-us/windows/win32/gdi/font-installation-and-deletion).

- The `font-list` package’s Windows backend shells out to PowerShell / WPF: `[Windows.Media.Fonts]::SystemFontFamilies` for family enumeration, and its detailed mode pulls `FontFamily.Source`, weight, style, stretch, and monospacing heuristics. Source: [font-list Windows backend](https://raw.githubusercontent.com/oldj/node-font-list/master/libs/win32/getByPowerShell.js), [font-list detailed Windows backend](https://raw.githubusercontent.com/oldj/node-font-list/master/libs/win32/getDetailedFontsByPowerShell.js).

- The `font-list` package also has a VBS fallback on Windows when PowerShell is unavailable. Source: [font-list Windows VBS backend](https://raw.githubusercontent.com/oldj/node-font-list/master/libs/win32/getByVBS.js).

### Linux

- Fontconfig is the standard API. `FcFontList(config, pattern, objectSet)` returns unique font patterns containing only the requested fields. Source: [FcFontList man page](https://man.archlinux.org/man/FcFontList.3.en).

- The `fc-list` CLI is the practical shell interface; it lists fonts/styles and can format output with requested fields such as family, style, file, and spacing. Source: [fc-list man page](https://man.archlinux.org/man/fc-list.1), [FcPatternFormat man page](https://man.archlinux.org/man/FcPatternFormat.3.en).

- The `font-list` Linux backend shells out to `fc-list -f "%{family[0]}\n"` for family names and `fc-list -f "%{family[0]}|%{postscriptname}|%{weight}|%{slant}|%{width}|%{spacing}\n"` for richer metadata. Source: [font-list Linux backend](https://raw.githubusercontent.com/oldj/node-font-list/master/libs/linux/index.js).

- The `fontmanager-redux` Linux backend uses `FcFontList` directly and asks for `FC_FILE`, `FC_POSTSCRIPT_NAME`, `FC_FAMILY`, `FC_STYLE`, `FC_WEIGHT`, `FC_WIDTH`, `FC_SLANT`, and `FC_SPACING`, so it can return file paths as part of the enumeration result. Source: [fontmanager-redux Linux backend](https://raw.githubusercontent.com/Eugeny/fontmanager-redux/master/src/FontManagerLinux.cc).

### npm packages and what they actually do

- `font-list`: cross-platform family/detailed enumeration. On Linux it uses `fc-list`; on macOS it uses a compiled helper plus `system_profiler` fallback; on Windows it uses PowerShell/WPF with a VBS fallback. It returns family names and some metadata, but not a direct file-path API on every platform. Source: [font-list core](https://raw.githubusercontent.com/oldj/node-font-list/master/libs/core.js), plus platform backends linked above.

- `get-system-fonts`: file-path resolver. It recursively walks the standard font directories for each platform and returns absolute paths to font files. Defaults include `ttf`, `otf`, `ttc`, `woff`, and `woff2`. Source: [get-system-fonts](https://raw.githubusercontent.com/princjef/get-system-fonts/master/src/index.ts).

- `font-finder`: metadata extractor built on `get-system-fonts`. It calls `getSystemFonts({ extensions: ['ttf', 'otf'] })`, parses each font file, and returns objects with `name`, `path`, `type`, `weight`, and `style`. Caveat: its source currently says `TODO: support woff, woff2, ttc`, so it is strongest for TTF/OTF embedding workflows. Source: [font-finder index](https://raw.githubusercontent.com/princjef/font-finder/master/src/index.ts), [font-finder parse helper](https://raw.githubusercontent.com/princjef/font-finder/master/src/parse.ts).

- `fontmanager-redux`: native addon that exposes platform-native enumeration with file paths. On macOS it uses CoreText and `kCTFontURLAttribute`; on Linux it uses fontconfig and returns `FC_FILE`; it also supports font matching/substitution. Source: [fontmanager-redux Mac backend](https://raw.githubusercontent.com/Eugeny/fontmanager-redux/master/src/FontManagerMac.mm), [fontmanager-redux Linux backend](https://raw.githubusercontent.com/Eugeny/fontmanager-redux/master/src/FontManagerLinux.cc).

# Recommendation

For this project’s emitter/parser design:

1. Treat PPTX embedded fonts as `p:embeddedFontLst` metadata plus font-data parts, and expect the payload may be EOT/MTX-wrapped rather than raw sfnt; do not confuse that with Word-style OOXML font obfuscation.
2. Accept only fonts whose `OS/2.fsType` allows the intended output mode; for editable exports, prefer `0` installable or `8` editable, and reject preview/print-only fonts unless you intentionally downgrade the deck to read-only.
3. Use the conservative shared font set above when you need to avoid embedding.
4. For Node-side enumeration:
   - use `font-list` or native APIs for family discovery/layout selection,
   - use `fontmanager-redux` or `get-system-fonts` + `font-finder` when you need real file paths for embedding.

# Open questions

- Do we want to support preview/print-only fonts by forcing read-only output, or reject them entirely to preserve editability?
- Do we need to support TTC / WOFF2 sources for embedding, or is TTF/OTF the only accepted input for the first cut?
- Should the font resolver prefer native APIs (`fontmanager-redux`) or a pure Node scan (`get-system-fonts` + `font-finder`) on each platform?