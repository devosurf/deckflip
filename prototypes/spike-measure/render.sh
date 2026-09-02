#!/bin/sh
# PROTOTYPE (wayfinder #8). Render out/spike.pptx through real PowerPoint (macOS) -> out/powerpoint.png.
# PowerPoint's AppleScript "save as PNG" silently writes nothing; "save as PDF" works but only to ~/Desktop (sandbox).
set -e
cd "$(dirname "$0")"
PPTX="$PWD/out/spike.pptx"
osascript <<EOF
tell application "Microsoft PowerPoint"
  activate
  try
    close presentation "spike.pptx" saving no
  end try
  open POSIX file "$PPTX"
  delay 2
  set p to presentation "spike.pptx"
  save p in "Macintosh HD:Users:$USER:Desktop:spike-export.pdf" as save as PDF
  delay 1
  close p saving no
end tell
EOF
mv "$HOME/Desktop/spike-export.pdf" out/powerpoint.pdf
swift pdf2png.swift out/powerpoint.pdf out/powerpoint.png 1280 720
