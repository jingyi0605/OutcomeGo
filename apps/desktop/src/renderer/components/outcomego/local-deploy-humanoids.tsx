import type { CSSProperties, ReactNode } from "react";

// The humanoid robots on the team poster (local-deploy-scenes.tsx), drawn the way Chinese character
// illustration draws young people: black hair, warm fair skin, round dark-brown eyes set low, small
// features, and clothes with a stand-up or crossed collar. What makes them robots is what they are
// built of around the face: lit pods at the ears, a smooth pearl neck with a ring of light, a pearl
// shell with jointed shoulders, and a core on the chest that carries the sign of their work. Their
// lights come up as the file reaches them (local-deploy-showcase.css).

export type Who = "researcher" | "writer" | "reviewer";

// Hair is coloured by the stylesheet (--hair, --shine), which gives it an edge on a dark stage.
const TRIM: Record<Who, [string, string]> = {
  researcher: ["#a9dcff", "#5b8df5"],
  writer: ["#e2d2ff", "#9d82f0"],
  reviewer: ["#a9b4ff", "#5863dc"],
};

const SKIN = "#ffecdf";
const SHADE = "#f3c6af";
const LASH = "#2b1b16";
const BROW = "#3c2b26";
const LIP = "#cf6a60";

/** Draws its children, and once more the other way round for the other side of the face. */
function BothSides({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <g transform="translate(160 0) scale(-1 1)">{children}</g>
    </>
  );
}

/** Neck with its lit ring, pearl chest with jointed shoulders, a collar, and the core. */
function Body({ children, collar, who }: { children: ReactNode; collar: "stand" | "cross"; who: Who }) {
  const trim = `url(#trim-${who})`;
  return (
    <>
      <path d="M69.5 122 H90.5 L93 152 H67 Z" fill={`url(#neck-${who})`} />
      <path d="M8 200 C8 170 28 153 60 146 H100 C132 153 152 170 152 200 Z" fill={`url(#shell-${who})`} />
      <BothSides>
        <path d="M8 200 C8 176 20 161 43 152.5 C35 166 32 182 33 200 Z" fill={trim} />
        <path d="M17 184 C19 174 25 166 34 161" fill="none" stroke="#ffffff" strokeLinecap="round" strokeOpacity="0.75" strokeWidth="2.6" />
        <circle className="vp-led" cx="27" cy="186" fill="#ffffff" r="3" />
        <path d="M45 157 C49 170 50 184 50 200" fill="none" stroke="#a5afe0" strokeLinecap="round" strokeOpacity="0.55" strokeWidth="1.3" />
      </BothSides>
      {collar === "stand" ? (
        <>
          {/* A stand-up collar open at the front, over a knotted button. */}
          <BothSides>
            <path d="M60.5 150 C59 142.5 62 137 67.5 134.5 C70 141.5 73.5 146 78.6 149.4 V157 C71 156.5 64.5 154.5 60.5 150 Z" fill={trim} />
            <path d="M65 139.5 C67.5 145.5 72 150 78 152.6" fill="none" stroke="#ffffff" strokeLinecap="round" strokeOpacity="0.6" strokeWidth="1.3" />
          </BothSides>
          <path d="M71.5 160.5 H88.5" stroke={TRIM[who][1]} strokeLinecap="round" strokeWidth="2.2" />
          <circle cx="80" cy="160.5" fill="#ffffff" r="2.6" stroke={TRIM[who][1]} strokeWidth="1.6" />
        </>
      ) : (
        <>
          {/* A crossed collar, closing to the wearer's right as it should: the band from the right of
              the picture lies on top. */}
          <path d="M60 146 C64 155 71 162 80 167 L86 160 C78 155 71 149 68 139.5 Z" fill={TRIM[who][0]} />
          <path d="M100 146 C95 157 84 168.5 67 177 L62 168.5 C76 161 86.5 151.5 92 139.5 Z" fill={trim} />
          <path d="M96.5 143.5 C91 154.5 80.5 164.5 65.5 172.4" fill="none" stroke="#ffffff" strokeLinecap="round" strokeOpacity="0.85" strokeWidth="1.5" />
        </>
      )}
      <path className="vp-led" d="M70.4 139.5 Q80 144.5 89.6 139.5" fill="none" stroke={TRIM[who][1]} strokeLinecap="round" strokeWidth="2.2" />
      <circle cx="80" cy="178" fill="#ffffff" r="12" />
      <circle cx="80" cy="178" fill="none" r="12" stroke={trim} strokeWidth="1.8" />
      <g className="vp-led">
        <circle cx="80" cy="178" fill={`url(#core-${who})`} r="9.4" />
        <g fill="none" stroke="#ffffff" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" transform="translate(8 17.8) scale(0.9)">
          {children}
        </g>
      </g>
    </>
  );
}

/** At each ear, a slim lit pod with a short plate rising from it. */
function Ears({ who }: { who: Who }) {
  return (
    <BothSides>
      <path d="M31.4 90 L26.6 69 C26 66 29.2 64.4 31.2 66.6 L40.6 89 Z" fill={`url(#trim-${who})`} />
      <rect fill={`url(#shell-${who})`} height="29" rx="7.2" stroke="#aeb9ea" strokeOpacity="0.8" strokeWidth="1" width="14.4" x="28.4" y="85" />
      <rect className="vp-led" fill={`url(#trim-${who})`} height="16" rx="2.5" width="5" x="33.1" y="91.5" />
    </BothSides>
  );
}

/** Two round dark-brown eyes with light in them, a small nose, warm cheeks, and a smile. */
function Features({
  brow,
  children,
  eye = [6.2, 8],
  girl = false,
  who,
}: {
  brow: ReactNode;
  children: ReactNode;
  eye?: [number, number];
  girl?: boolean;
  who: Who;
}) {
  return (
    <>
      <BothSides>
        <g fill="none" stroke={BROW} strokeLinecap="round">
          {brow}
        </g>
        <ellipse cx="53" cy="112" fill="#ff9c90" opacity="0.36" rx="7" ry="4.2" />
      </BothSides>
      <g className="vp-eyes">
        {[62, 98].map((x) => (
          <g key={x}>
            <ellipse cx={x} cy="98" fill={`url(#iris-${who})`} rx={eye[0]} ry={eye[1]} />
            <ellipse cx={x} cy="97.4" fill="#170d09" rx="3.3" ry="4.6" />
            <circle cx={x + 2.1} cy="94.4" fill="#ffffff" r="2.3" />
            <circle cx={x - 2.2} cy="102" fill="#ffffff" opacity="0.7" r="1.1" />
          </g>
        ))}
        <BothSides>
          <path d="M54 95.5 C56 88.6 67.5 87.6 70 93.8" fill="none" stroke={LASH} strokeLinecap="round" strokeWidth="2.3" />
          {girl ? <path d="M54 95.4 C52.6 94.8 51.4 93.6 50.6 92" fill="none" stroke={LASH} strokeLinecap="round" strokeWidth="1.8" /> : null}
        </BothSides>
      </g>
      <path d="M78.8 110.4 Q80 111.8 81.4 110.6" fill="none" stroke="#e0a189" strokeLinecap="round" strokeWidth="1.8" />
      {children}
    </>
  );
}

const ROUND_FACE = "M38.5 86 C37 57 56 40 80 40 C104 40 123 57 121.5 86 C121 106 112 121 99 128.5 C92.5 132 86.5 133.5 80 133.5 C73.5 133.5 67.5 132 61 128.5 C48 121 39 106 38.5 86 Z";
const SLIM_FACE = "M39.5 86 C38 57 57 40 80 40 C103 40 122 57 120.5 86 C120 104 111.5 118 98.5 128.5 C91 134.5 86 136.5 80 136.5 C74 136.5 69 134.5 61.5 128.5 C48.5 118 40 104 39.5 86 Z";

function Skin({ d, who }: { d: string; who: Who }) {
  return (
    <>
      <path d={d} fill={SKIN} />
      {/* The hair's soft shadow on the forehead. */}
      <path d="M40 86 C40 58 58 44 80 44 C102 44 120 58 120 86 Z" fill={`url(#shadow-${who})`} />
    </>
  );
}

/** Soft fringe and fine gold-rimmed glasses: the one who looks things up. */
function Researcher() {
  return (
    <>
      <g className="vp-head">
        <path className="vp-hair" d="M34 98 C25 62 38 23 80 23 C122 23 135 62 126 98 C124 107 118 111 113 111 H47 C42 111 36 107 34 98 Z" />
      </g>
      <Body collar="stand" who="researcher">
        <circle cx="78.6" cy="176.6" r="4" />
        <path d="M81.6 179.6 L85.2 183.2" />
      </Body>
      <g className="vp-head">
        <Skin d={ROUND_FACE} who="researcher" />
        <Features brow={<path d="M54.5 84.2 C58.5 81.4 64.5 81 69.5 82.8" strokeWidth="2.4" />} who="researcher">
          <path d="M74 119 Q80 124.6 86 119" fill="none" stroke={LIP} strokeLinecap="round" strokeWidth="2.4" />
        </Features>
        <path className="vp-hair" d="M83 27 C80 18 86 12 95 13 C90 16 89 20 92 27 Z" />
        <path className="vp-hair" d="M36 97 C27 62 40 27 80 26 C120 27 133 62 124 97 C122 88 119.5 81 115.5 75 C112 77.5 108 78.5 104 78 C105.5 75 106 72 105.5 69 C100 75 93 78.5 85.5 78.5 C88 75.5 89 72 88.5 68.5 C82 75 73.5 78.5 64.5 78 C67 75 68 72.5 68 69.5 C62 75 54.5 77 47.5 75.5 C42 80 38.5 88 36 97 Z" />
        <path d="M54 48 C61 38 76 34 92 37" fill="none" stroke="var(--shine)" strokeLinecap="round" strokeWidth="4" />
        <path d="M100 41 C103 42.5 105.5 44.5 107.5 47" fill="none" stroke="var(--shine)" strokeLinecap="round" strokeWidth="4" />
        <g fill="#ffffff" fillOpacity="0.07" stroke="#c39a5c" strokeWidth="1.8">
          <circle cx="62" cy="98.5" r="12.6" />
          <circle cx="98" cy="98.5" r="12.6" />
          <path d="M74.6 97 Q80 94 85.4 97" fill="none" />
          <path d="M49.5 96.5 L42 95 M110.5 96.5 L118 95" fill="none" strokeLinecap="round" />
        </g>
        <Ears who="researcher" />
      </g>
    </>
  );
}

/** Long hair, a light fringe, and a writing brush through the knot for a hairpin: the one who writes. */
function Writer() {
  return (
    <>
      <g className="vp-head">
        <g transform="rotate(48 112 32)">
          <rect fill="#b98a5c" height="60" rx="2.4" width="4.6" x="109.7" y="-2" />
          <rect className="vp-led" fill="#9d82f0" height="5.4" rx="2" width="6.6" x="108.7" y="-4" />
          <path d="M109 -4 C107.8 -11 109.8 -17 112 -21 C114.2 -17 116.2 -11 115 -4 Z" fill="#fff6ea" />
          <path d="M109.6 -14 C110.2 -17 111 -19.2 112 -21 C113 -19.2 113.8 -17 114.4 -14 C113 -12.8 111 -12.8 109.6 -14 Z" fill="#4a3a36" />
        </g>
        <circle className="vp-hair" cx="112" cy="33" r="16" />
        <path d="M103 29 C105 23.5 110 21 116 22" fill="none" stroke="var(--shine)" strokeLinecap="round" strokeWidth="3.2" />
        <path className="vp-hair" d="M32 102 C23 60 38 21 80 21 C122 21 137 60 128 102 C133 124 133 146 128 164 C121 170 112 166 107 154 H53 C48 166 39 170 32 164 C27 146 27 124 32 102 Z" />
      </g>
      <Body collar="cross" who="writer">
        <path d="M75 183.2 L76.3 178.6 L83 172 L86.2 175.2 L79.6 181.8 Z" />
      </Body>
      <g className="vp-head">
        <Skin d={ROUND_FACE} who="writer" />
        <Features brow={<path d="M55 84.6 C59 82 64.5 81.8 69 83.4" strokeWidth="2" />} girl who="writer">
          <path d="M74.2 118.6 Q80 126.4 85.8 118.6 Q80 120.6 74.2 118.6 Z" fill={LIP} stroke={LIP} strokeLinejoin="round" strokeWidth="1.6" />
        </Features>
        <path className="vp-hair" d="M37 97 C28 60 41 24 80 24 C119 24 132 60 123 97 C121 88 118 80.5 114 74.5 C110.5 78 106.5 79.5 102 79.5 C103.5 76 104 73 103 70.5 C98.5 76.5 93 80 87 80.5 C88.5 77 88.5 73.5 88 71 C83.5 77 77.5 80.5 71 80.5 C72.5 77 73 74 72.5 71.5 C68 77 62.5 79.5 57 79.5 C58.5 76.5 58.5 74 58 72 C50 77 41.5 86 37 97 Z" />
        <BothSides>
          <path className="vp-hair" d="M37.5 94 C33 112 33.5 134 39 152 C44.5 148 46.5 139 45.5 128 C43.5 116 42.5 105 44.5 92 Z" />
        </BothSides>
        <path d="M54 46 C62 36 78 32.5 96 36.5" fill="none" stroke="var(--shine)" strokeLinecap="round" strokeWidth="4" />
        <Ears who="writer" />
      </g>
    </>
  );
}

/** Young, his hair parted to the side with a little lift, clean brows: the one who reviews. */
function Reviewer() {
  return (
    <>
      <g className="vp-head">
        <path className="vp-hair" d="M36 97 C27 58 41 20 82 20 C120 20 134 58 125 97 C123 106 118 109 113 109 H47 C42 109 38 106 36 97 Z" />
      </g>
      <Body collar="stand" who="reviewer">
        <path d="M74.8 178.2 L78.6 182 L85.6 174.2" />
      </Body>
      <g className="vp-head">
        <Skin d={SLIM_FACE} who="reviewer" />
        <Features brow={<path d="M52 82.8 C57 80 64 80.4 70.5 83" strokeWidth="3" />} eye={[6, 7.2]} who="reviewer">
          <path d="M73.5 120 Q80.5 125.4 87 119" fill="none" stroke={LIP} strokeLinecap="round" strokeWidth="2.4" />
        </Features>
        <path className="vp-hair" d="M37 97 C27 70 30 42 46 31 C49 21 65 15.5 76 20 C84 12.5 103 15.5 109 25 C122 30 131 48 128 67 C127 78 125.5 88 123 97 C121.5 88 119 80 114 73 C109 67 103.5 61.5 98 53 C97.5 58.5 96 62.5 93 66.5 C91 63 90 60 89.5 56 C86 66 79 74 69.5 78.5 C72 74.5 73 71 73 67.5 C66 75 58 78.5 49.5 77.5 C44 82 40 89 37 97 Z" />
        <path d="M47 50 C51 38 63 30 78 29" fill="none" stroke="var(--shine)" strokeLinecap="round" strokeWidth="4" />
        <path d="M60 60 C69 56 77 49.5 81 42" fill="none" opacity="0.65" stroke="var(--shine)" strokeLinecap="round" strokeWidth="2.8" />
        <path d="M103 34 C111 39 116 47.5 117 57" fill="none" stroke="var(--shine)" strokeLinecap="round" strokeWidth="3.6" />
        <Ears who="reviewer" />
      </g>
    </>
  );
}

const FIGURES = { researcher: Researcher, writer: Writer, reviewer: Reviewer } as const;

/** One of them, from the chest up. `delay` sets their blinks and swaying apart. */
export function Humanoid({ delay = 0, who }: { delay?: number; who: Who }) {
  const Figure = FIGURES[who];
  const trim = TRIM[who];
  return (
    <svg aria-hidden="true" className="vp" data-who={who} style={{ "--delay": `${delay}s` } as CSSProperties} viewBox="0 0 160 196">
      <defs>
        <linearGradient id={`shell-${who}`} x1="0.2" x2="0.8" y1="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.6" stopColor="#eef1ff" />
          <stop offset="1" stopColor="#c6cff6" />
        </linearGradient>
        <linearGradient id={`trim-${who}`} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor={trim[0]} />
          <stop offset="1" stopColor={trim[1]} />
        </linearGradient>
        <linearGradient id={`neck-${who}`} x1="0" x2="1">
          <stop offset="0" stopColor="#c3ccf4" />
          <stop offset="0.5" stopColor="#f6f8ff" />
          <stop offset="1" stopColor="#c3ccf4" />
        </linearGradient>
        <linearGradient gradientUnits="userSpaceOnUse" id={`shadow-${who}`} x1="0" x2="0" y1="52" y2="86">
          <stop offset="0" stopColor={SHADE} stopOpacity="0.75" />
          <stop offset="1" stopColor={SHADE} stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`iris-${who}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#24140d" />
          <stop offset="0.55" stopColor="#4a2c1d" />
          <stop offset="1" stopColor="#8d5a3b" />
        </linearGradient>
        <radialGradient cx="0.4" cy="0.34" id={`core-${who}`} r="0.75">
          <stop offset="0" stopColor={trim[0]} />
          <stop offset="1" stopColor={trim[1]} />
        </radialGradient>
      </defs>
      <Figure />
    </svg>
  );
}
