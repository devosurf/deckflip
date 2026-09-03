# spool canvas

This folder is a [spool](https://spool.page) project: frames on an infinite canvas — agents author the files, humans arrange and play them.

Run `spool skill` before working here. It is the complete contract: if it isn't in there, spool doesn't do it. Topics: `spool skill frames|terminals|flows|scenarios|mock|styling|verbs`.

- A frame is born by writing `frames/<name>/frame.tsx` default-exporting one React component — no registration, no `spool new`. A `term.tsx` entry remains recognized as a terminal frame, but spool renders a static disabled surface and does not execute its source until project code can run inside an OS sandbox (`spool skill terminals`). A persisted terminal grid is readable only while source-current; saving a never-run terminal does not create one. Variants are `--`-named siblings (`checkout--empty/`).
- The one law: never write app-owned files — `canvas.json` and `.spool/` are spool's.
