import type { ReactNode } from "react";
import { cn } from "../../shared/lib/utils";

/* ---------------------------------------------------------------- primitives */

function Shell({ className, children }: { className?: string; children: ReactNode }) {
	return <div className={cn("mx-auto w-full max-w-[1120px] px-10", className)}>{children}</div>;
}

function Eyebrow({ className, children }: { className?: string; children: ReactNode }) {
	return (
		<p
			className={cn(
				"font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-ember-500",
				className,
			)}
		>
			{children}
		</p>
	);
}

function Panel({ className, children }: { className?: string; children: ReactNode }) {
	return (
		<div
			className={cn(
				"rounded-xl border border-line bg-ink-850 shadow-[0_24px_60px_-30px_rgba(0,0,0,0.9)]",
				className,
			)}
		>
			{children}
		</div>
	);
}

function PanelBar({ label, right }: { label: string; right?: ReactNode }) {
	return (
		<div className="flex items-center justify-between border-b border-line px-4 py-2.5">
			<div className="flex items-center gap-2">
				<span className="size-2 rounded-full bg-line-strong" />
				<span className="size-2 rounded-full bg-line-strong" />
				<span className="size-2 rounded-full bg-line-strong" />
				<span className="ml-2 font-mono text-[11px] text-mist-400">{label}</span>
			</div>
			{right}
		</div>
	);
}

/* Tiny syntax tokens — the code samples are hand-coloured, not highlighted. */
const T = {
	tag: ({ children }: { children: ReactNode }) => <span className="text-ember-400">{children}</span>,
	attr: ({ children }: { children: ReactNode }) => <span className="text-office-400">{children}</span>,
	str: ({ children }: { children: ReactNode }) => <span className="text-jade-400">{children}</span>,
	punc: ({ children }: { children: ReactNode }) => <span className="text-mist-600">{children}</span>,
	txt: ({ children }: { children: ReactNode }) => <span className="text-mist-200">{children}</span>,
	key: ({ children }: { children: ReactNode }) => <span className="text-mist-400">{children}</span>,
};

function Command({ value, className }: { value: string; className?: string }) {
	return (
		<div
			className={cn(
				"group flex items-center gap-3 rounded-lg border border-line bg-ink-900 py-3 pl-4 pr-3",
				className,
			)}
		>
			<span className="select-none font-mono text-[13px] text-ember-500">$</span>
			<code className="flex-1 text-left font-mono text-[13px] text-mist-200">{value}</code>
			<span className="rounded-md border border-line px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-mist-400">
				copy
			</span>
		</div>
	);
}

function Section({
	id,
	className,
	children,
}: {
	id?: string;
	className?: string;
	children: ReactNode;
}) {
	return (
		<section id={id} className={cn("border-t border-line/70 py-24", className)}>
			<Shell>{children}</Shell>
		</section>
	);
}

function SectionHead({
	eyebrow,
	title,
	blurb,
}: {
	eyebrow: string;
	title: ReactNode;
	blurb?: ReactNode;
}) {
	return (
		<header className="max-w-[720px]">
			<Eyebrow>{eyebrow}</Eyebrow>
			<h2 className="mt-4 font-display text-[38px] font-semibold leading-[1.15] tracking-[-0.02em] text-paper">
				{title}
			</h2>
			{blurb ? <p className="mt-4 text-[16px] leading-[1.7] text-mist-400">{blurb}</p> : null}
		</header>
	);
}

/* ---------------------------------------------------------------------- nav */

function Wordmark() {
	return (
		<div className="flex items-center gap-2.5">
			<span className="relative grid size-7 place-items-center rounded-[7px] bg-ember-500">
				<span className="absolute inset-y-1 left-1 w-[6px] rounded-[2px] bg-ink-950/85" />
				<span className="absolute inset-y-[9px] right-1 w-[9px] rounded-[2px] bg-ink-950/40" />
			</span>
			<span className="font-display text-[17px] font-semibold tracking-[-0.01em] text-paper">
				deckflip
			</span>
		</div>
	);
}

function Nav() {
	const links = ["The loop", "Round trip", "Report codes", "Agent skill"];
	return (
		<div className="sticky top-0 z-20 border-b border-line/70 bg-ink-950/85 backdrop-blur">
			<Shell className="flex h-16 items-center justify-between">
				<div className="flex items-center gap-9">
					<Wordmark />
					<nav className="flex items-center gap-7">
						{links.map((l) => (
							<span key={l} className="text-[13.5px] text-mist-400 hover:text-paper">
								{l}
							</span>
						))}
					</nav>
				</div>
				<div className="flex items-center gap-3">
					<span className="font-mono text-[11px] text-mist-600">v0.1.0</span>
					<span className="rounded-md border border-line px-3 py-1.5 text-[13px] text-mist-200">
						Docs
					</span>
					<span className="rounded-md bg-paper px-3 py-1.5 text-[13px] font-medium text-ink-950">
						GitHub
					</span>
				</div>
			</Shell>
		</div>
	);
}

/* --------------------------------------------------------------------- hero */

function CodeSide() {
	return (
		<Panel className="flex-1 overflow-hidden">
			<PanelBar
				label="deck.html"
				right={
					<span className="font-mono text-[10px] uppercase tracking-widest text-mist-600">
						you author this
					</span>
				}
			/>
			<pre className="overflow-hidden px-5 py-4 font-mono text-[12.5px] leading-[1.85]">
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
		</Panel>
	);
}

function Handle({ className }: { className: string }) {
	return (
		<span
			className={cn(
				"absolute size-[7px] rounded-[1px] border border-office-400 bg-white",
				className,
			)}
		/>
	);
}

function SlideSide() {
	return (
		<Panel className="flex-1 overflow-hidden">
			<PanelBar
				label="deck.pptx"
				right={
					<span className="font-mono text-[10px] uppercase tracking-widest text-mist-600">
						PowerPoint opens this
					</span>
				}
			/>
			<div className="p-5">
				<div className="relative aspect-video w-full overflow-hidden rounded-md bg-white">
					{/* the slide */}
					<div className="absolute inset-0 flex flex-col justify-center px-9">
						<div className="relative w-fit">
							<h3 className="font-display text-[30px] font-semibold leading-none tracking-[-0.02em] text-[#14171b]">
								Q3 Review
							</h3>
							{/* PowerPoint selection: this title is a real text box */}
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
		</Panel>
	);
}

function FlipArrows() {
	return (
		<div className="flex w-[132px] shrink-0 flex-col items-center gap-6 self-center">
			<div className="flex w-full flex-col items-center gap-2">
				<span className="font-mono text-[10px] uppercase tracking-[0.14em] text-mist-400">
					convert
				</span>
				<div className="flex w-full items-center">
					<span className="h-px flex-1 bg-gradient-to-r from-transparent to-ember-500" />
					<span className="-ml-px border-y-[5px] border-l-[8px] border-y-transparent border-l-ember-500" />
				</div>
			</div>
			<div className="flex w-full flex-col items-center gap-2">
				<div className="flex w-full items-center">
					<span className="-mr-px border-y-[5px] border-r-[8px] border-y-transparent border-r-office-400" />
					<span className="h-px flex-1 bg-gradient-to-l from-transparent to-office-400" />
				</div>
				<span className="text-center font-mono text-[10px] uppercase tracking-[0.14em] text-mist-400">
					convert back
				</span>
			</div>
		</div>
	);
}

function Hero() {
	return (
		<div className="relative overflow-hidden">
			{/* ambient light behind the headline */}
			<div className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-ember-600/12 blur-[120px]" />
			<div
				className="pointer-events-none absolute inset-0 opacity-[0.035]"
				style={{
					backgroundImage:
						"linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)",
					backgroundSize: "56px 56px",
					maskImage: "radial-gradient(ellipse 80% 50% at 50% 0%, #000 40%, transparent 100%)",
				}}
			/>
			<Shell className="relative pb-24 pt-24">
				<div className="flex flex-col items-center text-center">
					<span className="flex items-center gap-2 rounded-full border border-line bg-ink-900 py-1.5 pl-1.5 pr-3.5">
						<span className="rounded-full bg-ember-500/15 px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-widest text-ember-400">
							v0.1.0
						</span>
						<span className="text-[12.5px] text-mist-400">
							Bidirectional HTML ↔ PPTX, out now
						</span>
					</span>

					<h1 className="mt-7 max-w-[900px] font-display text-[68px] font-semibold leading-[1.04] tracking-[-0.035em] text-paper">
						HTML in. Editable
						<br />
						PowerPoint out. And back.
					</h1>

					<p className="mt-7 max-w-[660px] text-[17.5px] leading-[1.65] text-mist-400">
						deckflip turns HTML slides into real PowerPoint shapes, text, pictures, tables and
						groups — never screenshots. Convert a{" "}
						<span className="text-mist-200">.pptx</span> the other way, edit the HTML, convert it
						home: everything you didn't touch comes through byte for byte.
					</p>

					<div className="mt-9 w-full max-w-[560px]">
						<Command value="npx deckflip@latest convert deck.html -o deck.pptx" />
						<div className="mt-4 flex items-center justify-center gap-3">
							<span className="rounded-lg bg-ember-500 px-4 py-2.5 text-[13.5px] font-medium text-ink-950">
								Read the docs
							</span>
							<span className="rounded-lg border border-line bg-ink-900 px-4 py-2.5 text-[13.5px] text-mist-200">
								Install the agent skill
							</span>
						</div>
					</div>

					<p className="mt-6 font-mono text-[11px] tracking-wide text-mist-600">
						MIT · Node 20.16+ · no account, no service, no upload
					</p>
				</div>

				<div className="mt-20 flex items-stretch">
					<CodeSide />
					<FlipArrows />
					<SlideSide />
				</div>
			</Shell>
		</div>
	);
}

/* ----------------------------------------------------------------- proof bar */

const PROOF = [
	{
		k: "Native, not pictures",
		v: "Text, shapes, tables, lists and groups land as objects a human can click and edit.",
	},
	{
		k: "Nothing is silent",
		v: "Every rasterised, flattened or substituted construct gets a coded Report entry.",
	},
	{
		k: "Deterministic bytes",
		v: "Part ordering, relationship IDs, media names and timestamps are stable across runs.",
	},
	{
		k: "Built for agents",
		v: "JSON on stdout, meaningful exit codes, and a bundled skill for the fix-it loop.",
	},
];

function ProofBar() {
	return (
		<div className="border-y border-line/70 bg-ink-900/60">
			<Shell className="grid grid-cols-4 gap-px py-0">
				{PROOF.map((p) => (
					<div key={p.k} className="px-6 py-9 first:pl-0 last:pr-0">
						<h3 className="font-display text-[15px] font-semibold text-paper">{p.k}</h3>
						<p className="mt-2 text-[13.5px] leading-[1.6] text-mist-400">{p.v}</p>
					</div>
				))}
			</Shell>
		</div>
	);
}

/* ----------------------------------------------------------------- the loop */

const STEPS = [
	{
		n: "01",
		cmd: "validate",
		title: "Validate",
		body: "Reads the Deck, refuses the constructs PowerPoint has no answer for, and lists the rest as warnings with hints.",
	},
	{
		n: "02",
		cmd: "convert",
		title: "Convert",
		body: "Writes the .pptx and a sidecar report. --strict exits 4 when any entry remains, so a loop can act on it.",
	},
	{
		n: "03",
		cmd: "render",
		title: "Render",
		body: "Rasterises the result through LibreOffice or PowerPoint. Overflowing text and wrong stacking are visible here and nowhere else.",
	},
	{
		n: "04",
		cmd: "inspect",
		title: "Inspect",
		body: "Prints every element's kind, bounds, source (native or raster) and fonts — the structural check before you ship.",
	},
];

function TerminalPanel() {
	return (
		<Panel className="overflow-hidden">
			<PanelBar label="zsh" />
			<pre className="px-5 py-5 font-mono text-[12.5px] leading-[1.9]">
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
					<span className="text-mist-400">
						{"  slide 3  .glow   filter: blur(24px) → picture"}
					</span>
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
		</Panel>
	);
}

function LoopSection() {
	return (
		<Section id="loop">
			<SectionHead
				eyebrow="The loop"
				title={
					<>
						Four commands, and an exit code
						<br />
						that means something.
					</>
				}
				blurb="deckflip is a CLI first: JSON in, JSON out, no interactive step. An agent runs the loop until the report is empty; you read the rendered PNGs."
			/>
			<div className="mt-14 grid grid-cols-[1fr_1.15fr] gap-14">
				<ol className="space-y-7">
					{STEPS.map((s) => (
						<li key={s.n} className="flex gap-5">
							<span className="mt-0.5 font-mono text-[12px] text-mist-600">{s.n}</span>
							<div>
								<div className="flex items-baseline gap-2.5">
									<h3 className="font-display text-[17px] font-semibold text-paper">{s.title}</h3>
									<code className="rounded border border-line bg-ink-900 px-1.5 py-0.5 font-mono text-[11px] text-ember-400">
										deckflip {s.cmd}
									</code>
								</div>
								<p className="mt-2 max-w-[380px] text-[14px] leading-[1.65] text-mist-400">
									{s.body}
								</p>
							</div>
						</li>
					))}
				</ol>
				<div className="flex flex-col gap-5">
					<TerminalPanel />
					<div className="grid grid-cols-5 gap-2">
						{[
							["0", "ok", "text-jade-400"],
							["1", "no output", "text-rose-400"],
							["2", "validation", "text-rose-400"],
							["3", "bad args", "text-rose-400"],
							["4", "strict", "text-gold-400"],
						].map(([code, label, tone]) => (
							<div
								key={code}
								className="rounded-lg border border-line bg-ink-900 px-3 py-2.5 text-center"
							>
								<div className={cn("font-mono text-[15px] font-semibold", tone)}>{code}</div>
								<div className="mt-0.5 font-mono text-[10px] uppercase tracking-wide text-mist-600">
									{label}
								</div>
							</div>
						))}
					</div>
				</div>
			</div>
		</Section>
	);
}

/* -------------------------------------------------------------- round trip */

function DirectionCard({
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
	const accent = tone === "ember" ? "text-ember-400" : "text-office-400";
	const dot = tone === "ember" ? "bg-ember-500" : "bg-office-400";
	return (
		<Panel className="p-7">
			<div className="flex items-center gap-3 font-mono text-[11.5px]">
				<span className="rounded border border-line bg-ink-900 px-2 py-1 text-mist-200">{from}</span>
				<span className={accent}>→</span>
				<span className="rounded border border-line bg-ink-900 px-2 py-1 text-mist-200">{to}</span>
			</div>
			<h3 className="mt-5 font-display text-[21px] font-semibold tracking-[-0.01em] text-paper">
				{title}
			</h3>
			<p className="mt-3 text-[14.5px] leading-[1.7] text-mist-400">{body}</p>
			<ul className="mt-5 space-y-2.5 border-t border-line pt-5">
				{notes.map((n) => (
					<li key={n} className="flex gap-3 text-[13.5px] leading-[1.55] text-mist-200">
						<span className={cn("mt-[7px] size-1.5 shrink-0 rounded-full", dot)} />
						{n}
					</li>
				))}
			</ul>
		</Panel>
	);
}

function RoundTripSection() {
	return (
		<Section id="round-trip">
			<SectionHead
				eyebrow="Round trip"
				title="Both directions, and the way home is lossless."
				blurb="A PPTX carries more than deckflip's HTML dialect can say. So the source package stays beside the Deck, and everything you never touched is copied out of it, byte for byte."
			/>
			<div className="mt-12 grid grid-cols-2 gap-6">
				<DirectionCard
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
				<DirectionCard
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
			<div className="mt-6 flex items-center gap-4 rounded-xl border border-line bg-ink-900 px-6 py-5">
				<span className="font-mono text-[11px] uppercase tracking-[0.16em] text-mist-600">
					keep together
				</span>
				<code className="font-mono text-[13px] text-mist-200">
					deck.html <span className="text-mist-600">+</span> deck.assets/
				</code>
				<p className="text-[13.5px] text-mist-400">
					The Asset directory is what makes the trip home lossless. Move the Deck, move the folder.
				</p>
			</div>
		</Section>
	);
}

/* ------------------------------------------------------------------- subset */

const SUBSET = [
	{
		label: "Native",
		tone: "jade" as const,
		note: "Emitted as real PowerPoint objects",
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
		tone: "gold" as const,
		note: "A picture, with a report entry saying why",
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
		tone: "rose" as const,
		note: "VALIDATE_* error, exit 2, nothing written",
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

const TONE = {
	jade: { text: "text-jade-400", bg: "bg-jade-400", ring: "border-jade-400/30" },
	gold: { text: "text-gold-400", bg: "bg-gold-400", ring: "border-gold-400/30" },
	rose: { text: "text-rose-400", bg: "bg-rose-400", ring: "border-rose-400/30" },
};

function SubsetSection() {
	return (
		<Section id="subset">
			<SectionHead
				eyebrow="The authoring subset"
				title="You always know which of the three a construct is."
				blurb="The line between an editable object and a flat picture is documented, not discovered. Write inside the native column and a conversion comes out with an empty report."
			/>
			<div className="mt-12 grid grid-cols-3 gap-5">
				{SUBSET.map((col) => {
					const t = TONE[col.tone];
					return (
						<Panel key={col.label} className={cn("border-t-2 p-6", t.ring)}>
							<div className="flex items-center gap-2.5">
								<span className={cn("size-2 rounded-full", t.bg)} />
								<h3 className={cn("font-display text-[16px] font-semibold", t.text)}>
									{col.label}
								</h3>
							</div>
							<p className="mt-2 font-mono text-[11px] leading-[1.5] text-mist-600">{col.note}</p>
							<ul className="mt-5 space-y-3 border-t border-line pt-5">
								{col.items.map((i) => (
									<li key={i} className="text-[13px] leading-[1.55] text-mist-200">
										{i}
									</li>
								))}
							</ul>
						</Panel>
					);
				})}
			</div>
		</Section>
	);
}

/* ------------------------------------------------------------------- report */

function ReportSection() {
	return (
		<Section id="report">
			<div className="grid grid-cols-[0.95fr_1.05fr] items-center gap-16">
				<div>
					<SectionHead
						eyebrow="The Conversion report"
						title="Every deviation has a code — and a hint that is an edit."
						blurb="Nothing degrades quietly. Each entry names what happened, on which Slide, at which selector, why, and the change to your HTML that would make it native. That is what an agent loops on."
					/>
					<div className="mt-8 space-y-3">
						{[
							["VALIDATE_*", "stops the conversion", "text-rose-400"],
							["RASTER_*", "a picture was emitted", "text-gold-400"],
							["FLATTEN_*", "an effect dropped, the text kept", "text-gold-400"],
							["SUBSTITUTE_*", "an approximation you can accept", "text-mist-200"],
							["PRESERVE_*", "came through the round trip untouched", "text-office-400"],
						].map(([code, meaning, tone]) => (
							<div key={code} className="flex items-baseline gap-4">
								<code className={cn("w-[120px] shrink-0 font-mono text-[12.5px]", tone)}>
									{code}
								</code>
								<span className="text-[13.5px] text-mist-400">{meaning}</span>
							</div>
						))}
					</div>
				</div>

				<Panel className="overflow-hidden">
					<PanelBar
						label="deck.pptx.report.json"
						right={
							<span className="font-mono text-[10px] uppercase tracking-widest text-mist-600">
								machine-readable
							</span>
						}
					/>
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
				</Panel>
			</div>
		</Section>
	);
}

/* -------------------------------------------------------------------- skill */

function SkillSection() {
	return (
		<Section id="skill">
			<Panel className="relative overflow-hidden bg-ink-900 px-14 py-14">
				<div className="pointer-events-none absolute -right-24 -top-24 size-[420px] rounded-full bg-ember-600/10 blur-[90px]" />
				<div className="relative grid grid-cols-[1fr_0.9fr] items-center gap-16">
					<div>
						<Eyebrow>Agent skill</Eyebrow>
						<h2 className="mt-4 max-w-[460px] font-display text-[34px] font-semibold leading-[1.15] tracking-[-0.02em] text-paper">
							Hand the whole loop to your coding agent.
						</h2>
						<p className="mt-4 max-w-[480px] text-[15.5px] leading-[1.7] text-mist-400">
							One command installs the authoring skill and templates: the fix-it loop, the supported
							subset, every report code and its hint, font handling, and a seven-Slide starter Deck
							that converts with an empty report.
						</p>
						<Command
							className="mt-8 max-w-[440px]"
							value="npx skills add devosurf/deckflip"
						/>
					</div>
					<ul className="space-y-4">
						{[
							["SKILL.md", "The loop, the rules, the exit codes"],
							["templates/deck.html", "Seven Slides, zero report entries"],
							["templates/layouts/", "Title, divider, bullets, columns, image, big number"],
							["reference/report-codes.md", "Every code, meaning and fix"],
							["reference/fonts.md", "The safe set and how a stack resolves"],
						].map(([file, what]) => (
							<li
								key={file}
								className="flex items-baseline gap-4 border-b border-line pb-4 last:border-0"
							>
								<code className="w-[190px] shrink-0 font-mono text-[12.5px] text-ember-400">
									{file}
								</code>
								<span className="text-[13.5px] leading-[1.5] text-mist-400">{what}</span>
							</li>
						))}
					</ul>
				</div>
			</Panel>
		</Section>
	);
}

/* -------------------------------------------------------------------- close */

function Closer() {
	return (
		<Section className="border-t border-line/70 pb-20 pt-24">
			<div className="flex flex-col items-center text-center">
				<h2 className="max-w-[640px] font-display text-[44px] font-semibold leading-[1.1] tracking-[-0.03em] text-paper">
					Your next deck is a text file.
				</h2>
				<p className="mt-5 max-w-[520px] text-[16px] leading-[1.7] text-mist-400">
					No account, no upload, no service in the middle. A CLI, your HTML, and a .pptx that opens
					like anyone else's.
				</p>
				<Command className="mt-9 w-full max-w-[520px]" value="npx deckflip@latest --help" />
			</div>
		</Section>
	);
}

function Footer() {
	const cols = [
		["Docs", ["CLI reference", "Deck dialect", "Authoring subset", "Report codes"]],
		["Round trip", ["HTML → PPTX", "PPTX → HTML", "Fonts", "Rendering"]],
		["Project", ["GitHub", "Changelog", "Issues", "MIT license"]],
	] as const;
	return (
		<footer className="border-t border-line/70 bg-ink-900/50 py-14">
			<Shell>
				<div className="flex justify-between gap-20">
					<div className="max-w-[300px]">
						<Wordmark />
						<p className="mt-4 text-[13.5px] leading-[1.6] text-mist-400">
							Bidirectional conversion between HTML slides and PowerPoint, built for coding agents.
						</p>
						<p className="mt-5 font-mono text-[11px] text-mist-600">v0.1.0 · Node 20.16+ · MIT</p>
					</div>
					<div className="flex gap-20">
						{cols.map(([head, items]) => (
							<div key={head}>
								<h3 className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-mist-600">
									{head}
								</h3>
								<ul className="mt-4 space-y-2.5">
									{items.map((i) => (
										<li key={i} className="text-[13.5px] text-mist-200">
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

export default function Landing() {
	return (
		<div className="min-h-full bg-ink-950 font-sans antialiased">
			<Nav />
			<main>
				<Hero />
				<ProofBar />
				<LoopSection />
				<RoundTripSection />
				<SubsetSection />
				<ReportSection />
				<SkillSection />
				<Closer />
			</main>
			<Footer />
		</div>
	);
}
