import type { ReactNode } from "react";
import { cn } from "../../shared/lib/utils";

/*
 * Iteration B — "Console".
 * No hero image, no glow. The page is laid out like the tool itself: a fixed
 * left rail of sections, square corners, hairline everywhere, and one long
 * terminal session as the centrepiece — the slide arrives as command output.
 */

/* ---------------------------------------------------------------- primitives */

function Mono({ className, children }: { className?: string; children: ReactNode }) {
	return (
		<span
			className={cn(
				"font-mono text-[10.5px] font-medium uppercase tracking-[0.22em] text-mist-600",
				className,
			)}
		>
			{children}
		</span>
	);
}

/* Every box on this page is the same box: square, hairline, one shade up. */
function Box({ className, children }: { className?: string; children: ReactNode }) {
	return <div className={cn("border border-line bg-ink-900", className)}>{children}</div>;
}

function BoxHead({ label, right }: { label: string; right?: ReactNode }) {
	return (
		<div className="flex items-center justify-between border-b border-line bg-ink-850 px-4 py-2">
			<span className="font-mono text-[11px] text-mist-400">{label}</span>
			{right ? <Mono className="text-[9.5px]">{right}</Mono> : null}
		</div>
	);
}

const T = {
	tag: ({ children }: { children: ReactNode }) => <span className="text-ember-400">{children}</span>,
	attr: ({ children }: { children: ReactNode }) => (
		<span className="text-office-400">{children}</span>
	),
	str: ({ children }: { children: ReactNode }) => <span className="text-jade-400">{children}</span>,
	punc: ({ children }: { children: ReactNode }) => <span className="text-mist-600">{children}</span>,
	txt: ({ children }: { children: ReactNode }) => <span className="text-mist-200">{children}</span>,
	key: ({ children }: { children: ReactNode }) => <span className="text-mist-400">{children}</span>,
};

function Prompt() {
	return <span className="select-none text-ember-500">deckflip ❯ </span>;
}

function Section({
	n,
	label,
	title,
	blurb,
	children,
}: {
	n: string;
	label: string;
	title: ReactNode;
	blurb?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section className="border-t border-line px-16 py-16">
			<div className="flex items-baseline gap-4">
				<span className="font-mono text-[11px] text-ember-500">{n}</span>
				<Mono>{label}</Mono>
				<span className="h-px flex-1 bg-line" />
			</div>
			<h2 className="mt-7 max-w-[780px] font-display text-[34px] font-semibold leading-[1.15] tracking-[-0.025em] text-paper">
				{title}
			</h2>
			{blurb ? (
				<p className="mt-4 max-w-[700px] text-[15.5px] leading-[1.7] text-mist-400">{blurb}</p>
			) : null}
			<div className="mt-11">{children}</div>
		</section>
	);
}

/* ---------------------------------------------------------------------- rail */

const RAIL = [
	["00", "Overview"],
	["01", "The loop"],
	["02", "Round trip"],
	["03", "Subset"],
	["04", "Report"],
	["05", "Agent skill"],
];

function Rail() {
	return (
		<aside className="w-[264px] shrink-0 border-r border-line bg-ink-900/40">
			<div className="sticky top-0 px-7 py-8">
				<div className="flex items-center gap-2.5">
					<span className="relative grid size-7 place-items-center rounded-[2px] bg-ember-500">
						<span className="absolute inset-y-1 left-1 w-[6px] bg-ink-950/85" />
						<span className="absolute inset-y-[9px] right-1 w-[9px] bg-ink-950/40" />
					</span>
					<span className="font-display text-[17px] font-semibold tracking-[-0.01em] text-paper">
						deckflip
					</span>
				</div>
				<div className="mt-2 font-mono text-[11px] text-mist-600">v0.1.0 · MIT</div>

				<nav className="mt-10">
					{RAIL.map(([n, label], i) => (
						<div
							key={n}
							className={cn(
								"flex items-center gap-3 border-l py-2 pl-3.5",
								i === 0 ? "border-ember-500" : "border-line",
							)}
						>
							<span className="font-mono text-[10.5px] text-mist-600">{n}</span>
							<span
								className={cn(
									"text-[13px]",
									i === 0 ? "text-paper" : "text-mist-400 hover:text-paper",
								)}
							>
								{label}
							</span>
						</div>
					))}
				</nav>

				<div className="mt-10 border-t border-line pt-6">
					<Mono className="text-[9.5px]">Install</Mono>
					<div className="mt-3 flex items-center gap-2 border border-line bg-ink-950 px-3 py-2.5">
						<span className="font-mono text-[12px] text-ember-500">$</span>
						<code className="font-mono text-[11.5px] text-mist-200">npx deckflip@latest</code>
					</div>
					<div className="mt-2.5 border border-line bg-paper px-3 py-2.5 text-center text-[12.5px] font-medium text-ink-950">
						GitHub
					</div>
					<div className="mt-2 border border-line px-3 py-2.5 text-center text-[12.5px] text-mist-200">
						Docs
					</div>
				</div>

				<div className="mt-8 border-t border-line pt-6">
					<Mono className="text-[9.5px]">Requires</Mono>
					<p className="mt-2.5 font-mono text-[11px] leading-[1.8] text-mist-600">
						Node 20.16+
						<br />
						Chromium (bundled)
						<br />
						LibreOffice (render only)
					</p>
				</div>
			</div>
		</aside>
	);
}

/* ------------------------------------------------------------------ overview */

function Handle({ className }: { className: string }) {
	return (
		<span
			className={cn("absolute size-[7px] rounded-[1px] border border-office-400 bg-white", className)}
		/>
	);
}

/* The slide, small — it is command output here, not a hero image. */
function SlideOut() {
	return (
		<div className="relative aspect-video w-[360px] overflow-hidden bg-white">
			<div className="absolute inset-0 flex flex-col justify-center px-7">
				<div className="relative w-fit">
					<h3 className="font-display text-[22px] font-semibold leading-none tracking-[-0.02em] text-[#14171b]">
						Q3 Review
					</h3>
					<span className="absolute -inset-x-2.5 -inset-y-1.5 border border-dashed border-office-400" />
					<Handle className="-left-[13px] -top-[9px]" />
					<Handle className="-right-[13px] -top-[9px]" />
					<Handle className="-bottom-[9px] -left-[13px]" />
					<Handle className="-bottom-[9px] -right-[13px]" />
				</div>
				<p className="mt-3 text-[10px] text-[#6b727c]">Revenue, retention, roadmap</p>
				<ul className="mt-3.5 space-y-1.5 text-[10px] text-[#2b3037]">
					<li className="flex items-center gap-2">
						<span className="size-1 rounded-full bg-ember-500" />
						ARR up <strong className="font-semibold">34%</strong>
					</li>
					<li className="flex items-center gap-2">
						<span className="size-1 rounded-full bg-ember-500" />
						Churn down to 1.2%
					</li>
				</ul>
			</div>
			<div className="absolute -right-8 top-1/2 size-28 -translate-y-1/2 rounded-full bg-ember-500/12" />
			<div className="absolute bottom-2 right-3 font-mono text-[8px] text-[#aeb5bd]">01</div>
		</div>
	);
}

/* One long session: author, convert, look at it. The whole product in one panel. */
function Session() {
	return (
		<Box className="overflow-hidden">
			<BoxHead label="~/decks/q3 — zsh" right="one session, start to finish" />
			<div className="grid grid-cols-[1.05fr_1fr] divide-x divide-line">
				<pre className="px-5 py-5 font-mono text-[12px] leading-[1.85]">
					<code>
						<span className="text-mist-600">{"# the source you keep in git\n"}</span>
						<Prompt />
						<span className="text-mist-200">cat deck.html</span>
						{"\n"}
						<T.punc>{"<"}</T.punc>
						<T.tag>section</T.tag> <T.attr>id</T.attr>
						<T.punc>=</T.punc>
						<T.str>"cover"</T.str> <T.attr>data-title</T.attr>
						<T.punc>=</T.punc>
						<T.str>"Q3 Review"</T.str>
						<T.punc>{">"}</T.punc>
						{"\n  "}
						<T.punc>{"<"}</T.punc>
						<T.tag>h1</T.tag>
						<T.punc>{">"}</T.punc>
						<T.txt>Q3 Review</T.txt>
						<T.punc>{"</"}</T.punc>
						<T.tag>h1</T.tag>
						<T.punc>{">"}</T.punc>
						{"\n  "}
						<T.punc>{"<"}</T.punc>
						<T.tag>p</T.tag> <T.attr>class</T.attr>
						<T.punc>=</T.punc>
						<T.str>"lede"</T.str>
						<T.punc>{">"}</T.punc>
						<T.txt>Revenue, retention, roadmap</T.txt>
						<T.punc>{"</"}</T.punc>
						<T.tag>p</T.tag>
						<T.punc>{">"}</T.punc>
						{"\n  "}
						<T.punc>{"<"}</T.punc>
						<T.tag>ul</T.tag>
						<T.punc>{">"}</T.punc>
						{"\n    "}
						<T.punc>{"<"}</T.punc>
						<T.tag>li</T.tag>
						<T.punc>{">"}</T.punc>
						<T.txt>ARR up </T.txt>
						<T.punc>{"<"}</T.punc>
						<T.tag>strong</T.tag>
						<T.punc>{">"}</T.punc>
						<T.txt>34%</T.txt>
						<T.punc>{"</"}</T.punc>
						<T.tag>strong</T.tag>
						<T.punc>{">"}</T.punc>
						<T.punc>{"</"}</T.punc>
						<T.tag>li</T.tag>
						<T.punc>{">"}</T.punc>
						{"\n    "}
						<T.punc>{"<"}</T.punc>
						<T.tag>li</T.tag>
						<T.punc>{">"}</T.punc>
						<T.txt>Churn down to 1.2%</T.txt>
						<T.punc>{"</"}</T.punc>
						<T.tag>li</T.tag>
						<T.punc>{">"}</T.punc>
						{"\n  "}
						<T.punc>{"</"}</T.punc>
						<T.tag>ul</T.tag>
						<T.punc>{">"}</T.punc>
						{"\n  "}
						<T.punc>{"<"}</T.punc>
						<T.tag>aside</T.tag> <T.attr>class</T.attr>
						<T.punc>=</T.punc>
						<T.str>"notes"</T.str>
						<T.punc>{">"}</T.punc>
						<T.txt>Open on the ARR line.</T.txt>
						<T.punc>{"</"}</T.punc>
						<T.tag>aside</T.tag>
						<T.punc>{">"}</T.punc>
						{"\n"}
						<T.punc>{"</"}</T.punc>
						<T.tag>section</T.tag>
						<T.punc>{">"}</T.punc>
						{"\n\n"}
						<Prompt />
						<span className="text-mist-200">deckflip convert deck.html --strict -o deck.pptx</span>
						{"\n"}
						<span className="text-jade-400">✓</span>
						<span className="text-mist-400">
							{" report empty · 7 slides · 41 native elements"}
						</span>
						{"\n"}
						<span className="text-mist-600">{"  deck.pptx + deck.pptx.report.json · "}</span>
						<span className="text-jade-400">exit 0</span>
						{"\n\n"}
						<Prompt />
						<span className="text-mist-200">ls</span>
						{"\n"}
						<span className="text-mist-400">deck.html </span>
						<span className="text-office-400">deck.pptx </span>
						<span className="text-mist-600">deck.pptx.report.json </span>
						<span className="text-mist-400">deck.assets/</span>
						{"\n\n"}
						<span className="text-mist-600">
							{"# nothing uploaded, nothing installed globally,\n# nothing between you and the file"}
						</span>
					</code>
				</pre>

				<div className="flex flex-col">
					<div className="px-5 py-5 font-mono text-[12px] leading-[1.85]">
						<Prompt />
						<span className="text-mist-200">deckflip render deck.pptx --slide 1</span>
					</div>
					<div className="px-5 pb-5">
						<div className="inline-flex items-center gap-2 border border-line px-2 py-1">
							<span className="size-1.5 rounded-full bg-office-400" />
							<Mono className="text-[9px] text-mist-400">slide-01.png — opened in PowerPoint</Mono>
						</div>
						<div className="mt-3 border border-line p-2">
							<SlideOut />
						</div>
					</div>
					<div className="mt-auto border-t border-line px-5 py-4 font-mono text-[11.5px] leading-[1.9]">
						<Prompt />
						<span className="text-mist-200">deckflip inspect deck.pptx --slide 1</span>
						{"\n"}
						<table className="mt-2 w-full text-left">
							<tbody>
								{[
									["title", "textbox", "native", "914400 × 457200"],
									["lede", "textbox", "native", "914400 × 228600"],
									["metrics", "list", "native", "2 items"],
									["glow", "picture", "raster", "by data-raster"],
								].map(([name, kind, src, dim]) => (
									<tr key={name} className="border-t border-line/60">
										<td className="py-1.5 pr-3 text-mist-200">{name}</td>
										<td className="py-1.5 pr-3 text-mist-400">{kind}</td>
										<td
											className={cn(
												"py-1.5 pr-3",
												src === "native" ? "text-jade-400" : "text-gold-400",
											)}
										>
											{src}
										</td>
										<td className="py-1.5 text-mist-600">{dim}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			</div>
		</Box>
	);
}

function Overview() {
	return (
		<div className="px-16 pb-16 pt-14">
			<div className="flex items-baseline gap-4">
				<span className="font-mono text-[11px] text-ember-500">00</span>
				<Mono>Overview</Mono>
				<span className="h-px flex-1 bg-line" />
			</div>

			<h1 className="mt-9 font-display text-[60px] font-semibold leading-[1.02] tracking-[-0.04em] text-paper">
				HTML in. Editable
				<br />
				PowerPoint out. <span className="text-ember-500">And back.</span>
			</h1>
			<p className="mt-7 max-w-[720px] text-[15.5px] leading-[1.7] text-mist-400">
				deckflip turns HTML slides into real PowerPoint shapes, text, pictures, tables and groups —
				never screenshots. Convert a <span className="text-mist-200">.pptx</span> the other way, edit
				the HTML, convert it home: everything you didn't touch comes through byte for byte.
			</p>

			<div className="mt-10">
				<Session />
			</div>

			<div className="mt-4 grid grid-cols-4 divide-x divide-line border border-line">
				{[
					["Native, not pictures", "Objects a human can click and edit."],
					["Nothing is silent", "Every deviation gets a coded report entry."],
					["Deterministic bytes", "Stable part order, rel IDs, media names."],
					["Built for agents", "JSON on stdout, meaningful exit codes."],
				].map(([k, v]) => (
					<div key={k} className="px-5 py-5">
						<h3 className="text-[13.5px] font-semibold text-paper">{k}</h3>
						<p className="mt-1.5 text-[12.5px] leading-[1.55] text-mist-600">{v}</p>
					</div>
				))}
			</div>
		</div>
	);
}

/* ----------------------------------------------------------------- the loop */

const STEPS = [
	["01", "validate", "in: deck.html", "warnings + errors, JSON", "Refuses the constructs PowerPoint has no answer for; lists the rest with hints."],
	["02", "convert", "in: deck.html", "deck.pptx + report.json", "--strict exits 4 while any entry remains, so a loop has something to act on."],
	["03", "render", "in: deck.pptx", "slide-NN.png", "Through LibreOffice or PowerPoint. Overflow and stacking are visible only here."],
	["04", "inspect", "in: deck.pptx", "element table, JSON", "Kind, bounds, source and fonts — the structural check before you ship."],
];

function LoopSection() {
	return (
		<Section
			n="01"
			label="The loop"
			title="Four commands, and an exit code that means something."
			blurb="deckflip is a CLI first: JSON in, JSON out, no interactive step. An agent runs the loop until the report is empty; you read the rendered PNGs."
		>
			<Box>
				<div className="grid grid-cols-[64px_150px_150px_200px_1fr] border-b border-line bg-ink-850 px-5 py-2.5">
					{["", "command", "input", "output", "what it is for"].map((h, i) => (
						<Mono key={i} className="text-[9px]">
							{h}
						</Mono>
					))}
				</div>
				{STEPS.map(([n, cmd, input, output, body]) => (
					<div
						key={n}
						className="grid grid-cols-[64px_150px_150px_200px_1fr] items-baseline border-b border-line px-5 py-4 last:border-b-0"
					>
						<span className="font-mono text-[11px] text-mist-600">{n}</span>
						<code className="font-mono text-[13px] text-ember-400">{cmd}</code>
						<code className="font-mono text-[11.5px] text-mist-600">{input}</code>
						<code className="font-mono text-[11.5px] text-mist-400">{output}</code>
						<p className="text-[13.5px] leading-[1.6] text-mist-400">{body}</p>
					</div>
				))}
			</Box>

			<div className="mt-4 flex items-stretch border border-line">
				<div className="flex items-center border-r border-line px-5">
					<Mono className="text-[9px]">exit codes</Mono>
				</div>
				{[
					["0", "ok", "text-jade-400"],
					["1", "no output", "text-rose-400"],
					["2", "validation", "text-rose-400"],
					["3", "bad args", "text-rose-400"],
					["4", "strict, report not empty", "text-gold-400"],
				].map(([code, label, tone]) => (
					<div key={code} className="flex flex-1 items-baseline gap-3 border-r border-line px-5 py-4 last:border-r-0">
						<span className={cn("font-mono text-[15px] font-semibold", tone)}>{code}</span>
						<span className="font-mono text-[11px] text-mist-400">{label}</span>
					</div>
				))}
			</div>
		</Section>
	);
}

/* -------------------------------------------------------------- round trip */

function Node({ label, sub, tone }: { label: string; sub: string; tone: string }) {
	return (
		<div className="border border-line bg-ink-850 px-5 py-4 text-center">
			<code className={cn("font-mono text-[13px]", tone)}>{label}</code>
			<div className="mt-1 font-mono text-[10px] text-mist-600">{sub}</div>
		</div>
	);
}

function RoundTripSection() {
	return (
		<Section
			n="02"
			label="Round trip"
			title="Both directions, and the way home is lossless."
			blurb="A PPTX carries more than deckflip's HTML dialect can say. So the source package stays beside the Deck, and everything you never touched is copied out of it, byte for byte."
		>
			{/* the diagram, drawn in boxes and rules rather than illustrated */}
			<Box className="px-10 py-10">
				<div className="flex items-center justify-center gap-6">
					<Node label="deck.html" sub="you edit this" tone="text-ember-400" />
					<div className="flex w-[220px] flex-col gap-3">
						<div className="flex flex-col items-center gap-1.5">
							<Mono className="text-[9px]">convert --to pptx</Mono>
							<div className="flex w-full items-center">
								<span className="h-px flex-1 bg-ember-500/60" />
								<span className="-ml-px border-y-[5px] border-l-[8px] border-y-transparent border-l-ember-500" />
							</div>
						</div>
						<div className="flex flex-col items-center gap-1.5">
							<div className="flex w-full items-center">
								<span className="-mr-px border-y-[5px] border-r-[8px] border-y-transparent border-r-office-400" />
								<span className="h-px flex-1 bg-office-400/60" />
							</div>
							<Mono className="text-[9px]">convert --to html</Mono>
						</div>
					</div>
					<Node label="deck.pptx" sub="PowerPoint opens this" tone="text-office-400" />
				</div>
				<div className="mt-8 flex justify-center">
					<div className="flex items-center gap-4 border border-dashed border-line-strong px-5 py-3">
						<code className="font-mono text-[12.5px] text-mist-200">deck.assets/</code>
						<span className="text-[12.5px] text-mist-400">
							media, fonts, the Manifest and the source package — what makes the trip home lossless
						</span>
					</div>
				</div>
			</Box>

			<div className="mt-4 grid grid-cols-2 gap-4">
				{[
					{
						head: "Author in HTML, deliver PowerPoint",
						tone: "bg-ember-500",
						body: "Chromium lays out each Slide on a fixed 1280×720 Canvas; PowerPoint receives the measured boxes as native objects.",
						notes: [
							"Flex, grid, absolute, calc() and custom properties are all fair game",
							"Text is only ever native — effects on text are flattened, not screenshotted",
							"data-raster opts a subtree into one picture; data-group emits a group",
						],
					},
					{
						head: "Edit a deck someone else made",
						tone: "bg-office-400",
						body: "Convert writes deck.html and deck.assets/. Edit the HTML, convert it back — the parts you left alone are copied, not regenerated.",
						notes: [
							"Untouched content is preserved from the source package, byte for byte",
							"Charts, SmartArt, OLE and WordArt come through as opaque data-preserve elements",
							"validate deck.pptx lists every PRESERVE_* entry before you start editing",
						],
					},
				].map((c) => (
					<Box key={c.head} className="p-6">
						<h3 className="font-display text-[18px] font-semibold text-paper">{c.head}</h3>
						<p className="mt-2.5 text-[13.5px] leading-[1.65] text-mist-400">{c.body}</p>
						<ul className="mt-5 border-t border-line">
							{c.notes.map((n) => (
								<li
									key={n}
									className="flex gap-3 border-b border-line py-2.5 text-[13px] leading-[1.5] text-mist-200 last:border-b-0"
								>
									<span className={cn("mt-[7px] size-1.5 shrink-0", c.tone)} />
									{n}
								</li>
							))}
						</ul>
					</Box>
				))}
			</div>
		</Section>
	);
}

/* ------------------------------------------------------------------- subset */

const SUBSET = [
	{
		glyph: "+",
		label: "Native",
		note: "real PowerPoint objects",
		tone: "text-jade-400",
		items: [
			"h1–h6, p, li, td, blockquote, pre",
			"strong, em, u, s, code, mark, sup, sub, a",
			"solid fill, one linear-gradient, one background-image",
			"one outer box-shadow, no spread; inset too",
			"uniform solid / dashed / dotted border",
			"rotate, scale, translate",
			"img: object-fit, object-position, clip-path: inset()",
			"ul / ol to nine levels, and tables",
		],
	},
	{
		glyph: "~",
		label: "Rasterised",
		note: "a picture, plus a report entry",
		tone: "text-gold-400",
		items: [
			"filter, mask, backdrop-filter, mix-blend-mode",
			"conic, repeating and layered backgrounds",
			"multiple shadows, or any spread",
			"double, groove, ridge, inset, outset, border-image",
			"skew, matrix, 3D transforms, perspective",
			"inline <svg> — a vector picture",
			"anything under data-raster, on purpose",
		],
	},
	{
		glyph: "×",
		label: "Rejected",
		note: "VALIDATE_* error, exit 2",
		tone: "text-rose-400",
		items: [
			"script, iframe, object, embed, canvas, dialog",
			"form controls, details, marquee",
			"position: fixed | sticky, zoom, @page",
			"hyphens: auto, text-wrap: balance | pretty",
			"vertical writing-mode, column-*, text-orientation",
			"elements outside a section",
			"missing or remote assets",
		],
	},
];

function SubsetSection() {
	return (
		<Section
			n="03"
			label="Authoring subset"
			title="You always know which of the three a construct is."
			blurb="The line between an editable object and a flat picture is documented, not discovered. Write inside the native column and a conversion comes out with an empty report."
		>
			<div className="grid grid-cols-3 divide-x divide-line border border-line">
				{SUBSET.map((col) => (
					<div key={col.label}>
						<div className="flex items-baseline gap-2.5 border-b border-line bg-ink-850 px-5 py-3">
							<span className={cn("font-mono text-[13px] font-semibold", col.tone)}>
								{col.glyph}
							</span>
							<h3 className={cn("text-[14px] font-semibold", col.tone)}>{col.label}</h3>
							<Mono className="text-[9px]">{col.note}</Mono>
						</div>
						<ul>
							{col.items.map((i) => (
								<li
									key={i}
									className="border-b border-line px-5 py-2.5 font-mono text-[11.5px] leading-[1.5] text-mist-200 last:border-b-0"
								>
									{i}
								</li>
							))}
						</ul>
					</div>
				))}
			</div>
		</Section>
	);
}

/* ------------------------------------------------------------------- report */

function ReportSection() {
	return (
		<Section
			n="04"
			label="Conversion report"
			title="Every deviation has a code — and a hint that is an edit."
			blurb="Nothing degrades quietly. Each entry names what happened, on which Slide, at which selector, why, and the change to your HTML that would make it native. That is what an agent loops on."
		>
			<div className="grid grid-cols-[1fr_1fr] gap-4">
				<Box>
					<BoxHead label="report codes" right="five families" />
					{[
						["VALIDATE_*", "stops the conversion", "text-rose-400"],
						["RASTER_*", "a picture was emitted", "text-gold-400"],
						["FLATTEN_*", "an effect dropped, the text kept", "text-gold-400"],
						["SUBSTITUTE_*", "an approximation you can accept", "text-mist-200"],
						["PRESERVE_*", "came through the round trip untouched", "text-office-400"],
					].map(([code, meaning, tone]) => (
						<div
							key={code}
							className="flex items-baseline gap-5 border-b border-line px-5 py-3.5 last:border-b-0"
						>
							<code className={cn("w-[130px] shrink-0 font-mono text-[12.5px]", tone)}>{code}</code>
							<span className="text-[13px] text-mist-400">{meaning}</span>
						</div>
					))}
					<div className="border-t border-line bg-ink-850 px-5 py-3.5">
						<p className="text-[12.5px] leading-[1.6] text-mist-600">
							An entry is never advisory-only: every one carries a locator and a hint that names the
							edit.
						</p>
					</div>
				</Box>

				<Box>
					<BoxHead label="deck.pptx.report.json" right="machine-readable" />
					<pre className="px-5 py-5 font-mono text-[12px] leading-[1.85]">
						<code>
							<T.punc>{"{"}</T.punc>
							{"\n  "}
							<T.key>"code"</T.key>
							<T.punc>: </T.punc>
							<T.str>"FLATTEN_FILTER_ON_TEXT"</T.str>
							<T.punc>,</T.punc>
							{"\n  "}
							<T.key>"kind"</T.key>
							<T.punc>: </T.punc>
							<T.str>"flattened"</T.str>
							<T.punc>,</T.punc>
							{"\n  "}
							<T.key>"severity"</T.key>
							<T.punc>: </T.punc>
							<T.str>"warning"</T.str>
							<T.punc>,</T.punc>
							{"\n  "}
							<T.key>"slide"</T.key>
							<T.punc>: </T.punc>
							<span className="text-ember-400">3</span>
							<T.punc>,</T.punc>
							{"\n  "}
							<T.key>"locator"</T.key>
							<T.punc>: {"{ "}</T.punc>
							<T.key>"selector"</T.key>
							<T.punc>: </T.punc>
							<T.str>"#metrics {">"} h2"</T.str>
							<T.punc>{" }"},</T.punc>
							{"\n  "}
							<T.key>"reason"</T.key>
							<T.punc>: </T.punc>
							<T.str>"filter: drop-shadow(0 2px 8px …)</T.str>
							{"\n              "}
							<T.str>on a text-bearing element"</T.str>
							<T.punc>,</T.punc>
							{"\n  "}
							<T.key>"hint"</T.key>
							<T.punc>: </T.punc>
							<T.str>"Move the filter to a text-free</T.str>
							{"\n           "}
							<T.str>sibling behind the text, or accept</T.str>
							{"\n           "}
							<T.str>the flatten."</T.str>
							{"\n"}
							<T.punc>{"}"}</T.punc>
						</code>
					</pre>
				</Box>
			</div>
		</Section>
	);
}

/* -------------------------------------------------------------------- skill */

const TREE = [
	["SKILL.md", "The loop, the rules, the exit codes", 0],
	["templates/", "", 0],
	["deck.html", "Seven Slides, zero report entries", 1],
	["layouts/", "Title, divider, bullets, columns, image, big number", 1],
	["reference/", "", 0],
	["report-codes.md", "Every code, meaning and fix", 1],
	["fonts.md", "The safe set and how a stack resolves", 1],
] as const;

function SkillSection() {
	return (
		<Section
			n="05"
			label="Agent skill"
			title="Hand the whole loop to your coding agent."
			blurb="One command installs the authoring skill and templates: the fix-it loop, the supported subset, every report code and its hint, font handling, and a seven-Slide starter Deck that converts with an empty report."
		>
			<div className="grid grid-cols-[1fr_1fr] gap-4">
				<Box>
					<BoxHead label="deckflip/" right="what lands in your repo" />
					<div className="px-5 py-4">
						{TREE.map(([file, what, depth]) => (
							<div key={file} className="flex items-baseline gap-4 py-1.5">
								<code
									className={cn(
										"w-[210px] shrink-0 font-mono text-[12.5px]",
										what ? "text-ember-400" : "text-mist-400",
										depth === 1 && "pl-5",
									)}
								>
									{depth === 1 ? `└ ${file}` : file}
								</code>
								<span className="text-[12.5px] leading-[1.5] text-mist-600">{what}</span>
							</div>
						))}
					</div>
				</Box>

				<Box className="flex flex-col justify-center px-8 py-8">
					<Mono className="text-ember-400">Install</Mono>
					<div className="mt-4 flex items-center gap-3 border border-line bg-ink-950 py-3.5 pl-4 pr-3">
						<span className="font-mono text-[13px] text-ember-500">$</span>
						<code className="flex-1 font-mono text-[13px] text-mist-200">
							npx skills add devosurf/deckflip
						</code>
						<span className="border border-line px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-mist-400">
							copy
						</span>
					</div>
					<p className="mt-5 text-[13.5px] leading-[1.7] text-mist-400">
						After that, "make me a Q3 deck" is a task your agent can finish on its own: it authors
						the HTML, converts with <code className="font-mono text-mist-200">--strict</code>, reads
						the report, and edits until the exit code is 0.
					</p>
					<div className="mt-6 flex gap-2">
						{["Claude Code", "Cursor", "Codex", "any CLI agent"].map((a) => (
							<span
								key={a}
								className="border border-line px-2.5 py-1 font-mono text-[10.5px] text-mist-400"
							>
								{a}
							</span>
						))}
					</div>
				</Box>
			</div>
		</Section>
	);
}

/* -------------------------------------------------------------- close, foot */

function Closer() {
	return (
		<section className="border-t border-line px-16 py-20">
			<div className="flex items-end justify-between gap-16">
				<h2 className="max-w-[480px] font-display text-[42px] font-semibold leading-[1.08] tracking-[-0.035em] text-paper">
					Your next deck is a text file.
				</h2>
				<div className="w-[460px]">
					<p className="text-[15px] leading-[1.7] text-mist-400">
						No account, no upload, no service in the middle. A CLI, your HTML, and a .pptx that opens
						like anyone else's.
					</p>
					<div className="mt-5 flex items-center gap-3 border border-line bg-ink-900 py-3.5 pl-4 pr-3">
						<span className="font-mono text-[13px] text-ember-500">$</span>
						<code className="flex-1 font-mono text-[13px] text-mist-200">
							npx deckflip@latest --help
						</code>
						<span className="border border-line px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-mist-400">
							copy
						</span>
					</div>
				</div>
			</div>
		</section>
	);
}

function Footer() {
	const cols = [
		["Docs", ["CLI reference", "Deck dialect", "Authoring subset", "Report codes"]],
		["Round trip", ["HTML → PPTX", "PPTX → HTML", "Fonts", "Rendering"]],
		["Project", ["GitHub", "Changelog", "Issues", "MIT license"]],
	] as const;
	return (
		<footer className="border-t border-line px-16 py-12">
			<div className="flex justify-between gap-20">
				<div className="max-w-[300px]">
					<p className="text-[13.5px] leading-[1.6] text-mist-400">
						Bidirectional conversion between HTML slides and PowerPoint, built for coding agents.
					</p>
					<p className="mt-4 font-mono text-[11px] text-mist-600">v0.1.0 · Node 20.16+ · MIT</p>
				</div>
				<div className="flex gap-20">
					{cols.map(([head, items]) => (
						<div key={head}>
							<Mono className="text-[9.5px]">{head}</Mono>
							<ul className="mt-4 space-y-2.5">
								{items.map((i) => (
									<li key={i} className="text-[13px] text-mist-200">
										{i}
									</li>
								))}
							</ul>
						</div>
					))}
				</div>
			</div>
		</footer>
	);
}

/* --------------------------------------------------------------------- page */

export default function LandingConsole() {
	return (
		<div className="flex min-h-full bg-ink-950 font-sans antialiased">
			<Rail />
			<main className="min-w-0 flex-1">
				<Overview />
				<LoopSection />
				<RoundTripSection />
				<SubsetSection />
				<ReportSection />
				<SkillSection />
				<Closer />
				<Footer />
			</main>
		</div>
	);
}
