import type { ReactNode } from "react";
import { cn } from "../../shared/lib/utils";

/*
 * Iteration A — "Paper".
 * The dark original sells a developer tool. This one sells a document format:
 * a printed spec sheet, hairline rules, one accent, and the only dark things
 * on the page are the two artefacts — the code you write and the terminal.
 */

/* ---------------------------------------------------------------- primitives */

function Shell({ className, children }: { className?: string; children: ReactNode }) {
	return <div className={cn("mx-auto w-full max-w-[1240px] px-14", className)}>{children}</div>;
}

function Rule({ className }: { className?: string }) {
	return <div className={cn("h-px w-full bg-rule", className)} />;
}

function Label({ className, children }: { className?: string; children: ReactNode }) {
	return (
		<p
			className={cn(
				"font-mono text-[10.5px] font-medium uppercase tracking-[0.2em] text-mist-600",
				className,
			)}
		>
			{children}
		</p>
	);
}

/* A section is a ruled band with its number hung in the left margin. */
function Band({
	n,
	label,
	title,
	blurb,
	className,
	children,
}: {
	n: string;
	label: string;
	title: ReactNode;
	blurb?: ReactNode;
	className?: string;
	children: ReactNode;
}) {
	return (
		<section className={cn("border-t border-rule py-20", className)}>
			<Shell>
				<div className="grid grid-cols-[120px_1fr]">
					<div className="pt-1.5">
						<div className="font-mono text-[11px] tracking-[0.2em] text-ember-600">{n}</div>
						<div className="mt-1 font-mono text-[10.5px] uppercase tracking-[0.16em] text-mist-600">
							{label}
						</div>
					</div>
					<div>
						<h2 className="max-w-[860px] font-display text-[40px] font-semibold leading-[1.12] tracking-[-0.028em] text-ink-950">
							{title}
						</h2>
						{blurb ? (
							<p className="mt-5 max-w-[680px] text-[16.5px] leading-[1.65] text-[#4a5058]">
								{blurb}
							</p>
						) : null}
						<div className="mt-12">{children}</div>
					</div>
				</div>
			</Shell>
		</section>
	);
}

/* Syntax tokens, tuned for the dark inset panels. */
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

function Ink({ className, children }: { className?: string; children: ReactNode }) {
	return (
		<div className={cn("overflow-hidden rounded-[10px] bg-ink-950", className)}>{children}</div>
	);
}

function InkBar({ label, right }: { label: string; right?: ReactNode }) {
	return (
		<div className="flex items-center justify-between border-b border-[#1d2126] px-4 py-2.5">
			<span className="font-mono text-[11px] text-mist-400">{label}</span>
			{right ? (
				<span className="font-mono text-[10px] uppercase tracking-[0.16em] text-mist-600">
					{right}
				</span>
			) : null}
		</div>
	);
}

function Command({ value, className }: { value: string; className?: string }) {
	return (
		<div className={cn("flex items-center gap-3 rounded-[10px] bg-ink-950 py-3.5 pl-4 pr-3", className)}>
			<span className="select-none font-mono text-[13px] text-ember-500">$</span>
			<code className="flex-1 font-mono text-[13px] text-mist-200">{value}</code>
			<span className="rounded-md border border-[#262b31] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-mist-400">
				copy
			</span>
		</div>
	);
}

/* ---------------------------------------------------------------------- nav */

function Wordmark({ dark }: { dark?: boolean }) {
	return (
		<div className="flex items-center gap-2.5">
			<span className="relative grid size-7 place-items-center rounded-[7px] bg-ember-500">
				<span className="absolute inset-y-1 left-1 w-[6px] rounded-[2px] bg-white/85" />
				<span className="absolute inset-y-[9px] right-1 w-[9px] rounded-[2px] bg-white/40" />
			</span>
			<span
				className={cn(
					"font-display text-[17px] font-semibold tracking-[-0.01em]",
					dark ? "text-paper" : "text-ink-950",
				)}
			>
				deckflip
			</span>
		</div>
	);
}

function Nav() {
	const links = ["The loop", "Round trip", "Subset", "Report", "Skill"];
	return (
		<div className="sticky top-0 z-20 border-b border-rule bg-sheet-50/90 backdrop-blur">
			<Shell className="flex h-[68px] items-center justify-between">
				<div className="flex items-center gap-10">
					<Wordmark />
					<nav className="flex items-center gap-7">
						{links.map((l) => (
							<span
								key={l}
								className="font-mono text-[11.5px] uppercase tracking-[0.12em] text-mist-600 hover:text-ink-950"
							>
								{l}
							</span>
						))}
					</nav>
				</div>
				<div className="flex items-center gap-4">
					<span className="font-mono text-[11px] text-mist-600">v0.1.0</span>
					<span className="text-[13.5px] text-[#4a5058]">Docs</span>
					<span className="rounded-md bg-ink-950 px-3.5 py-1.5 text-[13px] font-medium text-paper">
						GitHub
					</span>
				</div>
			</Shell>
		</div>
	);
}

/* --------------------------------------------------------------------- hero */

function Masthead() {
	return (
		<Shell className="pb-16 pt-20">
			<Label className="text-ember-600">Bidirectional HTML ↔ PPTX</Label>
			<h1 className="mt-7 font-display text-[80px] font-semibold leading-[0.98] tracking-[-0.045em] text-ink-950">
				HTML in.
				<br />
				Editable PowerPoint out.
				<br />
				<span className="text-ember-600">And back.</span>
			</h1>

			<div className="mt-12 grid grid-cols-[1fr_300px] items-start gap-20 border-t border-rule pt-8">
				<p className="max-w-[640px] text-[18px] leading-[1.6] text-[#4a5058]">
					deckflip turns HTML slides into real PowerPoint shapes, text, pictures, tables and groups —
					never screenshots. Convert a <span className="text-ink-950">.pptx</span> the other way,
					edit the HTML, convert it home: everything you didn't touch comes through byte for byte.
				</p>

				{/* the colophon — this is a spec sheet, so it has one */}
				<dl className="-mt-1">
					{[
						["Version", "0.1.0"],
						["Runtime", "Node 20.16+"],
						["Licence", "MIT"],
						["Service", "None. Local only."],
					].map(([k, v]) => (
						<div key={k} className="flex justify-between border-b border-rule py-2.5 first:pt-0">
							<dt className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-mist-600">
								{k}
							</dt>
							<dd className="font-mono text-[11.5px] text-ink-950">{v}</dd>
						</div>
					))}
				</dl>
			</div>

			<div className="mt-10 flex items-center gap-4">
				<Command className="w-[520px]" value="npx deckflip@latest convert deck.html -o deck.pptx" />
				<span className="rounded-[10px] border border-rule-strong px-5 py-3.5 text-[13.5px] font-medium text-ink-950">
					Read the docs
				</span>
				<span className="rounded-[10px] px-2 py-3.5 text-[13.5px] text-[#4a5058] underline decoration-rule-strong underline-offset-4">
					Install the agent skill
				</span>
			</div>
		</Shell>
	);
}

/* ------------------------------------------------------------------- spread */

function CodeSheet() {
	return (
		<Ink>
			<InkBar label="deck.html" right="you author this" />
			<pre className="px-5 py-5 font-mono text-[12.5px] leading-[1.9]">
				<code>
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
					{"\n\n  "}
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
					{"\n\n  "}
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
				</code>
			</pre>
		</Ink>
	);
}

function Handle({ className }: { className: string }) {
	return (
		<span
			className={cn("absolute size-[7px] rounded-[1px] border border-office-400 bg-white", className)}
		/>
	);
}

function SlideSheet() {
	return (
		<div className="overflow-hidden rounded-[10px] border border-rule bg-white shadow-[0_18px_50px_-32px_rgba(20,23,27,0.5)]">
			<div className="flex items-center justify-between border-b border-rule px-4 py-2.5">
				<span className="font-mono text-[11px] text-mist-600">deck.pptx</span>
				<span className="font-mono text-[10px] uppercase tracking-[0.16em] text-mist-600">
					PowerPoint opens this
				</span>
			</div>
			<div className="p-5">
				<div className="relative aspect-video w-full overflow-hidden rounded-[4px] border border-sheet-200 bg-white">
					<div className="absolute inset-0 flex flex-col justify-center px-10">
						<div className="relative w-fit">
							<h3 className="font-display text-[32px] font-semibold leading-none tracking-[-0.025em] text-[#14171b]">
								Q3 Review
							</h3>
							<span className="absolute -inset-x-3 -inset-y-2 rounded-[2px] border border-dashed border-office-400" />
							<Handle className="-left-[15px] -top-[12px]" />
							<Handle className="-right-[15px] -top-[12px]" />
							<Handle className="-bottom-[12px] -left-[15px]" />
							<Handle className="-bottom-[12px] -right-[15px]" />
						</div>
						<p className="mt-4 text-[13px] text-[#6b727c]">Revenue, retention, roadmap</p>
						<ul className="mt-5 space-y-2 text-[13px] text-[#2b3037]">
							<li className="flex items-center gap-2.5">
								<span className="size-1.5 rounded-full bg-ember-500" />
								ARR up <strong className="font-semibold">34%</strong>
							</li>
							<li className="flex items-center gap-2.5">
								<span className="size-1.5 rounded-full bg-ember-500" />
								Churn down to 1.2%
							</li>
						</ul>
					</div>
					<div className="absolute -right-10 top-1/2 size-40 -translate-y-1/2 rounded-full bg-ember-500/12" />
					<div className="absolute bottom-3 right-4 font-mono text-[9px] text-[#aeb5bd]">01</div>
					<span className="absolute left-4 top-3 rounded-[3px] bg-office-400 px-1.5 py-0.5 font-mono text-[9px] font-medium text-white">
						Text box · editable
					</span>
				</div>
			</div>
		</div>
	);
}

function Spread() {
	return (
		<Shell className="pb-20">
			<Rule />
			<div className="grid grid-cols-[1fr_92px_1fr] items-stretch pt-10">
				<CodeSheet />
				<div className="flex flex-col items-center justify-center gap-8">
					<div className="flex w-full flex-col items-center gap-2">
						<span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-mist-600">
							convert
						</span>
						<div className="flex w-full items-center px-2">
							<span className="h-px flex-1 bg-gradient-to-r from-transparent to-ember-500" />
							<span className="-ml-px border-y-[5px] border-l-[8px] border-y-transparent border-l-ember-500" />
						</div>
					</div>
					<div className="flex w-full flex-col items-center gap-2">
						<div className="flex w-full items-center px-2">
							<span className="-mr-px border-y-[5px] border-r-[8px] border-y-transparent border-r-office-400" />
							<span className="h-px flex-1 bg-gradient-to-l from-transparent to-office-400" />
						</div>
						<span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-mist-600">
							back
						</span>
					</div>
				</div>
				<SlideSheet />
			</div>
			<p className="mt-6 text-center font-mono text-[11px] tracking-[0.05em] text-mist-600">
				Fig. 1 — the same slide, on both sides of the conversion. The title is a text box, not a
				picture of one.
			</p>
		</Shell>
	);
}

/* ---------------------------------------------------------------- the ledger */

const PROOF = [
	["Native, not pictures", "Text, shapes, tables, lists and groups land as objects a human can click and edit."],
	["Nothing is silent", "Every rasterised, flattened or substituted construct gets a coded Report entry."],
	["Deterministic bytes", "Part ordering, relationship IDs, media names and timestamps are stable across runs."],
	["Built for agents", "JSON on stdout, meaningful exit codes, and a bundled skill for the fix-it loop."],
];

function Ledger() {
	return (
		<div className="border-y border-rule bg-sheet-100">
			<Shell className="grid grid-cols-4 gap-14 py-11">
				{PROOF.map(([k, v], i) => (
					<div key={k}>
						<span className="font-mono text-[10.5px] text-ember-600">{`0${i + 1}`}</span>
						<h3 className="mt-2.5 font-display text-[15.5px] font-semibold text-ink-950">{k}</h3>
						<p className="mt-2 text-[13.5px] leading-[1.6] text-[#5b636d]">{v}</p>
					</div>
				))}
			</Shell>
		</div>
	);
}

/* ----------------------------------------------------------------- the loop */

const STEPS = [
	["01", "validate", "Validate", "Reads the Deck, refuses the constructs PowerPoint has no answer for, and lists the rest as warnings with hints."],
	["02", "convert", "Convert", "Writes the .pptx and a sidecar report. --strict exits 4 when any entry remains, so a loop can act on it."],
	["03", "render", "Render", "Rasterises the result through LibreOffice or PowerPoint. Overflowing text and wrong stacking are visible here and nowhere else."],
	["04", "inspect", "Inspect", "Prints every element's kind, bounds, source (native or raster) and fonts — the structural check before you ship."],
];

function Terminal() {
	return (
		<Ink>
			<InkBar label="zsh" right="one loop, until the report is empty" />
			<pre className="px-5 py-5 font-mono text-[12.5px] leading-[1.95]">
				<code>
					<span className="text-ember-500">$ </span>
					<span className="text-mist-200">npx deckflip@latest validate deck.html --json</span>
					{"\n"}
					<span className="text-jade-400">✓</span>
					<span className="text-mist-400"> 7 slides · 0 errors · 1 warning</span>
					{"\n\n"}
					<span className="text-ember-500">$ </span>
					<span className="text-mist-200">
						npx deckflip@latest convert deck.html --strict -o deck.pptx
					</span>
					{"\n"}
					<span className="text-gold-400">RASTER_FILTER</span>
					<span className="text-mist-400">{"  slide 3  .glow   filter: blur(24px) → picture"}</span>
					{"\n"}
					<span className="text-mist-600">
						{"                 hint: move the filter to a text-free sibling behind the text"}
					</span>
					{"\n"}
					<span className="text-mist-400">deck.pptx + deck.pptx.report.json written · </span>
					<span className="text-gold-400">exit 4</span>
					{"\n\n"}
					<span className="text-ember-500">$ </span>
					<span className="text-mist-200">
						npx deckflip@latest convert deck.html --strict -o deck.pptx
					</span>
					{"\n"}
					<span className="text-jade-400">✓</span>
					<span className="text-mist-400"> report empty · 7 slides · 41 native elements · </span>
					<span className="text-jade-400">exit 0</span>
				</code>
			</pre>
		</Ink>
	);
}

function LoopBand() {
	return (
		<Band
			n="01"
			label="The loop"
			title="Four commands, and an exit code that means something."
			blurb="deckflip is a CLI first: JSON in, JSON out, no interactive step. An agent runs the loop until the report is empty; you read the rendered PNGs."
		>
			<div className="grid grid-cols-[0.85fr_1.15fr] gap-16">
				<ol>
					{STEPS.map(([n, cmd, title, body]) => (
						<li key={n} className="border-t border-rule py-6 first:border-t-0 first:pt-0">
							<div className="flex items-baseline gap-3">
								<span className="font-mono text-[11px] text-ember-600">{n}</span>
								<h3 className="font-display text-[18px] font-semibold text-ink-950">{title}</h3>
								<code className="font-mono text-[11.5px] text-mist-600">deckflip {cmd}</code>
							</div>
							<p className="mt-2 text-[14px] leading-[1.65] text-[#5b636d]">{body}</p>
						</li>
					))}
				</ol>
				<div>
					<Terminal />
					<div className="mt-4 grid grid-cols-5 gap-3">
						{[
							["0", "ok", "text-jade-400"],
							["1", "no output", "text-rose-400"],
							["2", "validation", "text-rose-400"],
							["3", "bad args", "text-rose-400"],
							["4", "strict", "text-gold-400"],
						].map(([code, label, tone]) => (
							<div key={code} className="border-t-2 border-sheet-200 pt-2.5 text-center">
								<div
									className={cn(
										"font-mono text-[16px] font-semibold",
										tone === "text-jade-400"
											? "text-[#1f9c6d]"
											: tone === "text-gold-400"
												? "text-[#b07d13]"
												: "text-[#c8323c]",
									)}
								>
									{code}
								</div>
								<div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-mist-600">
									{label}
								</div>
							</div>
						))}
					</div>
				</div>
			</div>
		</Band>
	);
}

/* -------------------------------------------------------------- round trip */

function Direction({
	from,
	to,
	title,
	body,
	notes,
	tone,
}: {
	from: string;
	to: string;
	title: string;
	body: string;
	notes: string[];
	tone: "ember" | "office";
}) {
	return (
		<div>
			<div className="flex items-center gap-3 font-mono text-[11.5px]">
				<span className="rounded border border-rule bg-white px-2 py-1 text-ink-950">{from}</span>
				<span className={tone === "ember" ? "text-ember-600" : "text-office-400"}>→</span>
				<span className="rounded border border-rule bg-white px-2 py-1 text-ink-950">{to}</span>
			</div>
			<h3 className="mt-5 font-display text-[22px] font-semibold tracking-[-0.015em] text-ink-950">
				{title}
			</h3>
			<p className="mt-3 text-[14.5px] leading-[1.7] text-[#5b636d]">{body}</p>
			<ul className="mt-6">
				{notes.map((n) => (
					<li
						key={n}
						className="flex gap-3 border-t border-rule py-3 text-[13.5px] leading-[1.55] text-[#33383f]"
					>
						<span
							className={cn(
								"mt-[7px] size-1.5 shrink-0 rounded-full",
								tone === "ember" ? "bg-ember-500" : "bg-office-400",
							)}
						/>
						{n}
					</li>
				))}
			</ul>
		</div>
	);
}

function RoundTripBand() {
	return (
		<Band
			n="02"
			label="Round trip"
			title="Both directions, and the way home is lossless."
			blurb="A PPTX carries more than deckflip's HTML dialect can say. So the source package stays beside the Deck, and everything you never touched is copied out of it, byte for byte."
		>
			<div className="grid grid-cols-2 gap-16 divide-x divide-rule">
				<Direction
					tone="ember"
					from="deck.html"
					to="deck.pptx"
					title="Author in HTML, deliver PowerPoint"
					body="Chromium lays out each Slide on a fixed 1280×720 Canvas; PowerPoint receives the measured boxes as native objects."
					notes={[
						"Flex, grid, absolute, calc() and custom properties are all fair game",
						"Text is only ever native — effects on text are flattened, not screenshotted",
						"data-raster opts a subtree into one intentional picture; data-group emits a group",
					]}
				/>
				<div className="pl-16">
					<Direction
						tone="office"
						from="deck.pptx"
						to="deck.html"
						title="Edit a deck someone else made"
						body="Convert writes deck.html and deck.assets/ — media, fonts, the Manifest and the source package. Edit the HTML, convert it back."
						notes={[
							"Untouched content is preserved from the source package, byte for byte",
							"Charts, SmartArt, OLE and WordArt come through as opaque data-preserve elements",
							"validate deck.pptx lists every PRESERVE_* entry before you start editing",
						]}
					/>
				</div>
			</div>
			<div className="mt-12 flex items-center gap-5 border-l-2 border-ember-500 bg-sheet-100 px-6 py-5">
				<code className="font-mono text-[13px] text-ink-950">
					deck.html <span className="text-mist-600">+</span> deck.assets/
				</code>
				<p className="text-[13.5px] text-[#5b636d]">
					The Asset directory is what makes the trip home lossless. Move the Deck, move the folder.
				</p>
			</div>
		</Band>
	);
}

/* ------------------------------------------------------------------- subset */

const SUBSET = [
	{
		label: "Native",
		note: "Emitted as real PowerPoint objects",
		swatch: "bg-[#1f9c6d]",
		text: "text-[#1f9c6d]",
		items: [
			"All text: h1–h6, p, li, td, blockquote, pre",
			"Runs: strong, em, u, s, code, mark, sup, sub, a",
			"Solid fills, one linear-gradient, one background-image",
			"One outer box-shadow without spread, inset too",
			"Uniform solid / dashed / dotted borders",
			"rotate, scale, translate",
			"img with object-fit, object-position, clip-path: inset()",
			"ul / ol nine levels deep, and tables",
		],
	},
	{
		label: "Rasterised",
		note: "A picture, with a report entry saying why",
		swatch: "bg-[#b07d13]",
		text: "text-[#b07d13]",
		items: [
			"filter, mask, backdrop-filter, mix-blend-mode",
			"Conic, repeating and layered backgrounds",
			"Multiple shadows, or any spread",
			"double, groove, ridge, inset, outset, border-image",
			"skew, matrix, 3D transforms and perspective",
			"Inline <svg> — a vector picture, editable as a picture",
			"Anything under data-raster, on purpose",
		],
	},
	{
		label: "Rejected",
		note: "VALIDATE_* error, exit 2, nothing written",
		swatch: "bg-[#c8323c]",
		text: "text-[#c8323c]",
		items: [
			"script, iframe, object, embed, canvas, dialog",
			"Form controls, details, marquee",
			"position: fixed | sticky, zoom, @page",
			"hyphens: auto, text-wrap: balance | pretty",
			"Vertical writing-mode, column-*, text-orientation",
			"Elements outside a section",
			"Missing or remote assets",
		],
	},
];

function SubsetBand() {
	return (
		<Band
			n="03"
			label="Authoring subset"
			title="You always know which of the three a construct is."
			blurb="The line between an editable object and a flat picture is documented, not discovered. Write inside the native column and a conversion comes out with an empty report."
		>
			<div className="grid grid-cols-3 gap-10">
				{SUBSET.map((col) => (
					<div key={col.label}>
						<div className="flex items-center gap-2.5">
							<span className={cn("size-2 rounded-full", col.swatch)} />
							<h3 className={cn("font-display text-[16px] font-semibold", col.text)}>
								{col.label}
							</h3>
						</div>
						<p className="mt-2 font-mono text-[10.5px] leading-[1.5] text-mist-600">{col.note}</p>
						<ul className="mt-5">
							{col.items.map((i) => (
								<li
									key={i}
									className="border-t border-rule py-3 text-[13px] leading-[1.5] text-[#33383f]"
								>
									{i}
								</li>
							))}
						</ul>
					</div>
				))}
			</div>
		</Band>
	);
}

/* ------------------------------------------------------------------- report */

function ReportBand() {
	return (
		<Band
			n="04"
			label="Conversion report"
			title="Every deviation has a code — and a hint that is an edit."
			blurb="Nothing degrades quietly. Each entry names what happened, on which Slide, at which selector, why, and the change to your HTML that would make it native. That is what an agent loops on."
		>
			<div className="grid grid-cols-[0.9fr_1.1fr] gap-16">
				<div>
					{[
						["VALIDATE_*", "stops the conversion", "text-[#c8323c]"],
						["RASTER_*", "a picture was emitted", "text-[#b07d13]"],
						["FLATTEN_*", "an effect dropped, the text kept", "text-[#b07d13]"],
						["SUBSTITUTE_*", "an approximation you can accept", "text-ink-950"],
						["PRESERVE_*", "came through the round trip untouched", "text-office-400"],
					].map(([code, meaning, tone]) => (
						<div key={code} className="flex items-baseline gap-5 border-t border-rule py-3.5">
							<code className={cn("w-[130px] shrink-0 font-mono text-[12.5px]", tone)}>{code}</code>
							<span className="text-[13.5px] text-[#5b636d]">{meaning}</span>
						</div>
					))}
				</div>

				<Ink>
					<InkBar label="deck.pptx.report.json" right="machine-readable" />
					<pre className="px-5 py-5 font-mono text-[12px] leading-[1.9]">
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
				</Ink>
			</div>
		</Band>
	);
}

/* -------------------------------------------------------------------- skill */

function SkillBand() {
	return (
		<section className="border-t border-rule bg-ink-950 py-20">
			<Shell>
				<div className="grid grid-cols-[1fr_0.95fr] items-center gap-20">
					<div>
						<Label className="text-ember-400">Agent skill</Label>
						<h2 className="mt-5 max-w-[460px] font-display text-[38px] font-semibold leading-[1.12] tracking-[-0.028em] text-paper">
							Hand the whole loop to your coding agent.
						</h2>
						<p className="mt-5 max-w-[480px] text-[15.5px] leading-[1.7] text-mist-400">
							One command installs the authoring skill and templates: the fix-it loop, the supported
							subset, every report code and its hint, font handling, and a seven-Slide starter Deck
							that converts with an empty report.
						</p>
						<div className="mt-9 flex max-w-[440px] items-center gap-3 rounded-[10px] border border-[#262b31] bg-ink-900 py-3.5 pl-4 pr-3">
							<span className="font-mono text-[13px] text-ember-500">$</span>
							<code className="flex-1 font-mono text-[13px] text-mist-200">
								npx skills add devosurf/deckflip
							</code>
							<span className="rounded-md border border-[#262b31] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-mist-400">
								copy
							</span>
						</div>
					</div>
					<ul>
						{[
							["SKILL.md", "The loop, the rules, the exit codes"],
							["templates/deck.html", "Seven Slides, zero report entries"],
							["templates/layouts/", "Title, divider, bullets, columns, image, big number"],
							["reference/report-codes.md", "Every code, meaning and fix"],
							["reference/fonts.md", "The safe set and how a stack resolves"],
						].map(([file, what]) => (
							<li
								key={file}
								className="flex items-baseline gap-5 border-t border-[#1d2126] py-4 last:pb-0"
							>
								<code className="w-[190px] shrink-0 font-mono text-[12.5px] text-ember-400">
									{file}
								</code>
								<span className="text-[13.5px] leading-[1.5] text-mist-400">{what}</span>
							</li>
						))}
					</ul>
				</div>
			</Shell>
		</section>
	);
}

/* -------------------------------------------------------------------- close */

function Closer() {
	return (
		<section className="py-24">
			<Shell>
				<div className="grid grid-cols-[120px_1fr] items-end">
					<div />
					<div className="flex items-end justify-between gap-16">
						<h2 className="max-w-[560px] font-display text-[52px] font-semibold leading-[1.05] tracking-[-0.035em] text-ink-950">
							Your next deck is a text file.
						</h2>
						<div className="w-[420px] pb-2">
							<p className="text-[15.5px] leading-[1.7] text-[#5b636d]">
								No account, no upload, no service in the middle. A CLI, your HTML, and a .pptx that
								opens like anyone else's.
							</p>
							<Command className="mt-6" value="npx deckflip@latest --help" />
						</div>
					</div>
				</div>
			</Shell>
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
		<footer className="border-t border-rule bg-sheet-100 py-14">
			<Shell>
				<div className="flex justify-between gap-20">
					<div className="max-w-[300px]">
						<Wordmark />
						<p className="mt-4 text-[13.5px] leading-[1.6] text-[#5b636d]">
							Bidirectional conversion between HTML slides and PowerPoint, built for coding agents.
						</p>
						<p className="mt-5 font-mono text-[11px] text-mist-600">v0.1.0 · Node 20.16+ · MIT</p>
					</div>
					<div className="flex gap-20">
						{cols.map(([head, items]) => (
							<div key={head}>
								<h3 className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-mist-600">
									{head}
								</h3>
								<ul className="mt-4 space-y-2.5">
									{items.map((i) => (
										<li key={i} className="text-[13.5px] text-[#33383f]">
											{i}
										</li>
									))}
								</ul>
							</div>
						))}
					</div>
				</div>
			</Shell>
		</footer>
	);
}

/* --------------------------------------------------------------------- page */

export default function LandingPaper() {
	return (
		<div className="min-h-full bg-sheet-50 font-sans antialiased">
			<Nav />
			<main>
				<Masthead />
				<Spread />
				<Ledger />
				<LoopBand />
				<RoundTripBand />
				<SubsetBand />
				<ReportBand />
				<SkillBand />
				<Closer />
			</main>
			<Footer />
		</div>
	);
}
