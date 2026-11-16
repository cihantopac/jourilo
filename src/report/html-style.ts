// Report styles in the Daybook identity: warm paper, ink and brass, the Newsreader-style serif of the wordmark for
// headings and numbers, and the wordmark's diamond as the recurring mark. Every text color keeps at least 4.5:1
// on the surfaces it is used on, in both themes.

// 60/30/10: paper surfaces, ink text and lines, brass only for interaction (links, buttons, the selected tab, focus,
// the checkbox). Severity colour lives only in the 8 px dot before the severity word; good/poor colour only in metric
// values.
const LIGHT = `color-scheme:light;
--paper:#f4efe4;--sheet:#fffdf8;--sheet-2:#f8f3e8;--ink:#1c1a17;--ink-2:#46443f;--muted:#65635f;--line:#e6dece;--line-2:#d3c8b1;
--brass:#875802;--brass-mark:#a8762b;--brass-soft:#f5ead8;--brass-ink:#6a4400;
--dot-critical:#c62828;--dot-serious:#d8590c;--dot-moderate:#c9960a;--dot-minor:#8b8f96;--dot-info:#8b8f96;
--good:#14713a;--poor:#b91c1c;--ni:#8a5604;
--hl:#d61f4b;--shadow:0 1px 2px rgba(28,26,23,.04),0 8px 24px -16px rgba(28,26,23,.18);`;

const DARK = `color-scheme:dark;
--paper:#13110d;--sheet:#1c1a17;--sheet-2:#232019;--ink:#f4efe4;--ink-2:#dcd6cb;--muted:#b9b4aa;--line:#33302a;--line-2:#4a463f;
--brass:#d9af79;--brass-mark:#bf8e49;--brass-soft:#2c2214;--brass-ink:#eccfab;
--dot-critical:#f87171;--dot-serious:#fb923c;--dot-moderate:#facc15;--dot-minor:#a8a29e;--dot-info:#a8a29e;
--good:#4ade80;--poor:#f87171;--ni:#f2c14e;
--hl:#ff5c86;--shadow:0 1px 2px rgba(0,0,0,.3),0 10px 28px -16px rgba(0,0,0,.6);`;

export const REPORT_CSS = `
:root{${LIGHT}}
:root[data-theme=dark]{${DARK}}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){${DARK}}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.serif,h1,h2,h3,.kpi .num,.brand-sub{font-family:Newsreader,"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua",Georgia,serif;font-weight:500}
h1,h2,h3,h4{line-height:1.2;margin:0}
h2{font-size:24px;letter-spacing:-.01em}
h3{font-size:18px}
h4{font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin:20px 0 8px;font-weight:600}
a{color:var(--brass);text-underline-offset:2px}
a:hover{color:var(--ink)}
code,pre,kbd{font:12.5px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
code{overflow-wrap:anywhere}
pre{white-space:pre-wrap;word-break:break-word;background:var(--sheet-2);border:1px solid var(--line);padding:8px 10px;border-radius:8px;margin:6px 0}
:focus-visible{outline:2px solid var(--brass);outline-offset:2px}
button,select,input,textarea{font:inherit;color:inherit}
.muted{color:var(--muted)}
.poor{color:var(--poor)}
.wrap{max-width:1180px;margin:0 auto;padding:0 24px}
.skip{position:absolute;left:12px;top:-60px;background:var(--ink);color:var(--paper);padding:8px 12px;border-radius:8px;z-index:50}
.skip:focus{top:12px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.diamond{display:inline-block;width:8px;height:8px;background:var(--brass-mark);transform:rotate(45deg);flex:none}

/* masthead */
.mast{background:var(--sheet);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:20}
.mast-in{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;padding-top:12px;padding-bottom:10px}
.brand{display:flex;align-items:baseline;gap:14px;color:var(--ink)}
.brand svg{display:block;flex:none;height:30px;width:auto;align-self:center}
.brand-sub{font-size:16px;color:var(--muted)}
.tools{display:flex;gap:10px;flex-wrap:wrap}
.seg{display:inline-flex;border:1px solid var(--line-2);border-radius:999px;padding:2px;background:var(--paper)}
.seg button{border:0;background:none;padding:4px 11px;border-radius:999px;cursor:pointer;font-size:13px;color:var(--muted);display:inline-flex;align-items:center;gap:6px;min-height:28px}
.seg button[aria-pressed=true]{background:var(--ink);color:var(--paper)}
.seg button svg{width:14px;height:14px}
.tabs{display:flex;gap:2px;overflow-x:auto;scrollbar-width:thin}
.tabs [role=tab]{border:0;background:none;border-bottom:2px solid transparent;padding:10px 12px 9px;color:var(--muted);cursor:pointer;white-space:nowrap;font-size:14.5px}
.tabs [role=tab][aria-selected=true]{color:var(--ink);border-color:var(--brass);font-weight:600}
.tabs [role=tab]:hover{color:var(--brass)}
.tabs .count{font-size:12px;color:var(--muted);margin-left:4px;font-weight:400}

/* hero */
.hero{padding:34px 0 8px;display:grid;gap:10px}
.eyebrow{font-size:12.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--brass);font-weight:600;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.hero h1{font-size:clamp(28px,4.4vw,44px);letter-spacing:-.02em;overflow-wrap:anywhere}
.lede{font-size:17px;max-width:72ch;color:var(--ink-2);margin:0}
.scope{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:13.5px;color:var(--muted);margin:0}
.scope span{display:inline-flex;align-items:center;gap:8px}

/* KPIs */
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin:22px 0 6px}
.kpi{background:var(--sheet);border:1px solid var(--line);border-radius:12px;padding:12px 14px 11px;display:grid;gap:2px;box-shadow:var(--shadow)}
.kpi .lbl{font-size:12.5px;color:var(--muted);font-weight:600}
.kpi .num{font-size:32px;line-height:1.1;font-variant-numeric:tabular-nums}
.kpi .sub{font-size:12.5px;color:var(--muted)}
.kpi.alert .num{color:var(--poor)}
.kpi.ok .num{color:var(--good)}
.sevbar{display:flex;height:5px;border-radius:3px;overflow:hidden;background:var(--line);margin-top:4px}
.sevbar i{display:block}
.noscore{font-size:13px;color:var(--muted);margin:8px 0 0;display:flex;gap:10px;align-items:center}

/* sections */
.panel{padding-bottom:40px}
.block{margin-top:36px}
.block-h{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px}
.block-h p{margin:4px 0 0;color:var(--muted);font-size:14px}

/* blocked journeys */
.blocked{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px}
.bj{background:var(--sheet);border:1px solid var(--line);border-top:3px solid var(--poor);border-radius:12px;overflow:hidden;display:grid;grid-template-rows:auto 1fr;box-shadow:var(--shadow)}
.bj figure{margin:0;position:relative;background:var(--sheet-2);border-bottom:1px solid var(--line)}
.bj figure img{display:block;width:100%;aspect-ratio:16/9;object-fit:cover;object-position:top}
.bj figure figcaption{position:absolute;left:10px;top:10px;background:var(--poor);color:var(--sheet);font-size:12px;font-weight:600;padding:2px 8px;border-radius:999px}
.bj .in{padding:12px 14px 14px;display:grid;gap:6px;align-content:start}
.bj h3{font-size:17px}
.bj .err{font-size:13px;color:var(--ink-2);background:var(--sheet-2);border-left:3px solid var(--poor);padding:6px 10px;border-radius:0 6px 6px 0;overflow-wrap:anywhere}
.bj .criteria{font-size:13.5px}
.bj .row{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-top:4px}

/* root-cause cards */
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}
.rc-card{background:var(--sheet);border:1px solid var(--line);border-radius:16px;overflow:hidden;display:grid;grid-template-rows:auto 1fr;box-shadow:var(--shadow);position:relative}
.rc-card .vis{background:var(--sheet-2);aspect-ratio:2/1;overflow:hidden;display:grid;align-items:center}
.rc-card .vis .crop{border:0;border-radius:0}
.rc-card .ba{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--line)}
.rc-card .ba figure{margin:0;background:var(--sheet-2);position:relative}
.rc-card .ba figcaption{position:absolute;left:8px;top:8px;z-index:1;font-size:11px;font-weight:600;letter-spacing:.04em;background:var(--sheet);color:var(--ink);padding:1px 8px;border-radius:999px}
.rc-card .ba .crop{border:0;border-radius:0}
.rc-card .ba figure.after .box{outline-color:var(--good);box-shadow:0 0 0 4px rgba(20,113,58,.22)}
.cover{display:block;width:100%;height:100%;object-fit:cover;object-position:top}
.rc-card .in{padding:16px 18px 16px;display:grid;gap:6px;align-content:start}
.rc-card h3{font-size:18px;line-height:1.3;margin-bottom:4px}
.rc-card h3 a{color:var(--ink);text-decoration:none}
.rc-card h3 a:hover{color:var(--brass)}
.rc-card .row{display:flex;justify-content:space-between;align-items:center;gap:6px 12px;flex-wrap:wrap;margin-top:auto}
.rc-card .where{font-size:13px;color:var(--muted);overflow-wrap:anywhere;min-width:0}
.rc-card .where code{font-size:12px}
.pick{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:var(--muted);cursor:pointer}
.pick input{width:17px;height:17px;accent-color:var(--brass);margin:0;cursor:pointer}

/* chips and severity */
.chips{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.chip{display:inline-flex;align-items:center;gap:5px;border-radius:999px;padding:0 9px;font-size:12px;line-height:22px;background:var(--sheet-2);border:1px solid var(--line);color:var(--ink-2);max-width:100%;overflow-wrap:anywhere}
.sev{display:inline-flex;align-items:center;gap:7px;font-size:13px;font-weight:600;color:var(--ink-2);white-space:nowrap}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;flex:none;background:var(--dot-minor)}
.dot-critical{background:var(--dot-critical)}.dot-serious{background:var(--dot-serious)}.dot-moderate{background:var(--dot-moderate)}.dot-minor{background:var(--dot-minor)}.dot-info{background:var(--dot-info)}

/* lanes */
.lanes{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:14px}
.lane{background:var(--sheet);border:1px solid var(--line);border-radius:12px;padding:14px 16px;display:grid;gap:6px;align-content:start}
.lane.k-needs-review{border-style:dashed;border-color:var(--line-2)}
.lane.k-hypothesis{background:var(--brass-soft);border-color:transparent}
.lane .head{display:flex;align-items:baseline;justify-content:space-between;gap:10px}
.lane .head .num{font-family:Newsreader,Georgia,serif;font-size:28px;line-height:1}
.lane p{margin:0;font-size:13.5px;color:var(--muted)}
.lane ul{margin:4px 0 0;padding:0;list-style:none;font-size:14px}
.lane li{display:flex;gap:9px;align-items:baseline}
.lane li::before{content:"";width:6px;height:6px;background:var(--brass-mark);transform:rotate(45deg);flex:none;position:relative;top:-2px}
.lane li a{display:inline-block;padding:3px 0;min-height:24px}
.lane li .n{color:var(--muted);font-size:12.5px;white-space:nowrap}

/* limitations */
.limits{background:var(--sheet);border:1px solid var(--line);border-radius:12px;padding:14px 18px}
.limits ul{margin:6px 0 0;padding-left:18px;font-size:14px}
.limits li{margin:4px 0}
details.more>summary,details.fold>summary{cursor:pointer;color:var(--brass);font-weight:600;font-size:14px;padding:4px 0;list-style-position:outside}
details.fold{background:var(--sheet);border:1px solid var(--line);border-radius:12px;padding:10px 16px;margin-top:12px}

/* findings */
.toolbar{position:sticky;top:var(--mast-h,96px);z-index:10;background:var(--paper);padding:14px 0 10px;border-bottom:1px solid var(--line);display:grid;gap:8px}
.filters{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:end}
.filters label{display:grid;gap:2px;font-size:12px;color:var(--muted);font-weight:600}
.filters select{padding:5px 8px;background:var(--sheet);border:1px solid var(--line-2);border-radius:8px;max-width:210px;font-size:13.5px;color:var(--ink);min-height:32px}
.tb-row{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;font-size:13px}
.btn{border:1px solid var(--line-2);background:var(--sheet);border-radius:999px;padding:6px 14px;cursor:pointer;font-size:13.5px;font-weight:600;color:var(--ink);min-height:32px;display:inline-flex;align-items:center;gap:6px;text-decoration:none}
.btn:hover{border-color:var(--brass);color:var(--brass)}
.btn.primary{background:var(--brass);color:var(--sheet);border-color:var(--brass)}
.btn.primary:hover{background:var(--brass-ink);border-color:var(--brass-ink);color:var(--sheet)}
.btn.ghost{border-color:transparent;background:none;color:var(--brass)}
.kgroup{margin-top:26px}
.kgroup>header{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:8px}
.kgroup>header p{margin:0;color:var(--muted);font-size:13.5px}
.rc{display:grid;grid-template-columns:auto minmax(0,1fr);gap:0 12px;align-items:start;background:var(--sheet);border:1px solid var(--line);border-radius:14px;margin:10px 0;padding-left:16px;transition:border-color .15s}
.rc:hover{border-color:var(--line-2)}
.rc>.pick{padding-top:17px}
.rc>details{min-width:0}
.rc>details>summary{cursor:pointer;padding:14px 18px 14px 0;display:grid;gap:4px;list-style:none;border-radius:14px}
.rc>details>summary::-webkit-details-marker{display:none}
.rc>details>summary .t{display:flex;gap:6px 14px;align-items:baseline;flex-wrap:wrap}
.rc>details>summary .tt{font-weight:600;font-size:16px;line-height:1.35;flex:1 1 240px;min-width:0;overflow-wrap:anywhere}
.rc>details>summary .t::after{content:"";width:7px;height:7px;border-right:1.5px solid var(--muted);border-bottom:1.5px solid var(--muted);transform:rotate(45deg);flex:none;position:relative;top:-3px;transition:transform .15s}
.rc>details[open]>summary .t::after{transform:rotate(-135deg);top:1px}
.rc>details>summary:hover .tt{color:var(--brass)}
.rc .where{font-size:13px;color:var(--muted);overflow-wrap:anywhere}
.rc.st-fixed{opacity:.85}
.body{padding:6px 18px 18px 0;display:grid;gap:14px}
.body p{margin:0}
.fig{margin:0;max-width:820px}
.fig .crop{border-radius:12px;max-height:440px}
.fig .shot{display:block;max-width:100%;max-height:440px;border:1px solid var(--line);border-radius:12px;object-fit:cover;object-position:top}
.stats{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:10px}
.stats li{background:var(--sheet-2);border-radius:12px;padding:10px 16px 9px;display:grid;gap:0;min-width:118px}
.stats .v{font-family:Newsreader,"Iowan Old Style",Georgia,serif;font-size:24px;line-height:1.15;font-variant-numeric:tabular-nums}
.stats .l{font-size:12px;color:var(--muted)}
.fix{font-size:15.5px;max-width:72ch}
.fix b{font-weight:600;margin-right:6px}
details.more{margin-top:2px}
details.more>summary{list-style:none;display:inline-flex;align-items:center;gap:8px}
details.more>summary::-webkit-details-marker{display:none}
details.more>summary::before{content:"";width:6px;height:6px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(-45deg);transition:transform .15s;margin:0 2px}
details.more[open]>summary::before{transform:rotate(45deg)}
.body details.more[open]{border-top:1px solid var(--line);padding-top:4px}
.body details.more>summary{margin:6px 0 4px}
.body details.more>p{margin:8px 0 0;color:var(--ink-2);max-width:80ch}
dl.facts{display:grid;grid-template-columns:120px minmax(0,1fr);gap:10px 18px;margin:16px 0 4px}
dl.facts dt{color:var(--muted);font-size:13px}
dl.facts dt::first-letter{text-transform:uppercase}
dl.facts dd{margin:0;font-size:14.5px;min-width:0}
dl.facts dd ol{margin:0;padding-left:18px}
.stds{list-style:none;padding:0;margin:0}
.stds a{display:inline-block;padding:2px 0;min-height:24px}
.instances{list-style:none;padding:0;margin:0;display:grid;gap:6px;font-size:13.5px}
.instances li{display:flex;gap:8px 10px;align-items:center;flex-wrap:wrap}
.sources{list-style:none;padding:0;margin:0;display:grid;gap:8px;font-size:14px}
ul.evidence{list-style:none;padding:0;margin:0;display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(min(100%,320px),1fr))}
li.ev{border-radius:12px;padding:10px;overflow:hidden;display:grid;gap:6px;align-content:start;background:var(--sheet-2)}
.evtype{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:600}
.crop{position:relative;overflow:hidden;border:1px solid var(--line);border-radius:8px;width:100%;background:#fff}
.crop img{position:absolute;height:auto;max-width:none;display:block}
.crop .box{position:absolute;outline:2px solid var(--hl);box-shadow:0 0 0 4px rgba(214,31,75,.22);border-radius:2px}
.thumb{display:block;max-width:100%;max-height:260px;border:1px solid var(--line);border-radius:8px}
.data{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:12.5px}
.note{font-size:12.5px;color:var(--muted)}
.empty{padding:18px;text-align:center;color:var(--muted);border:1px dashed var(--line-2);border-radius:12px;margin-top:16px}

/* journeys */
.journey{background:var(--sheet);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin:16px 0;box-shadow:var(--shadow)}
.journey.failed,.journey.blocked{border-top:3px solid var(--poor)}
.journey.passed{border-top:3px solid var(--good)}
.journey-h{display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap}
.timeline{list-style:none;margin:14px 0 4px;padding:4px 2px 12px;display:flex;gap:0;overflow-x:auto;scroll-snap-type:x proximity}
.timeline li{flex:0 0 220px;scroll-snap-align:start;display:grid;grid-template-rows:auto auto 1fr;gap:6px;padding-right:14px;position:relative}
.timeline .rail{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;color:var(--muted)}
.timeline .rail::after{content:"";flex:1;height:2px;background:var(--line-2)}
.timeline li:last-child .rail::after{background:transparent}
.timeline .dot{width:12px;height:12px;transform:rotate(45deg);background:var(--good);flex:none;margin:0 2px}
.timeline li.failed .dot,.timeline li.blocked .dot{background:var(--poor)}
.timeline li.skipped .dot{background:var(--line-2)}
.timeline li.skipped{opacity:.55}
.timeline .shot{display:block;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--sheet-2)}
.timeline .shot img{display:block;width:100%;aspect-ratio:16/10;object-fit:cover;object-position:top}
.timeline .noshot{aspect-ratio:16/10;display:grid;place-items:center;font-size:12px;color:var(--muted);border:1px dashed var(--line-2);border-radius:8px}
.timeline li.failed .shot,.timeline li.blocked .shot{border:2px solid var(--poor)}
.timeline .desc{font-size:13px;overflow-wrap:anywhere}
.timeline .here{color:var(--poor);font-weight:700;font-size:12px}
.timeline pre{font-size:11.5px;max-height:120px;overflow:auto}
.timeline li.goal{flex:0 0 260px}
.goalbox{border:1px solid var(--line);border-radius:8px;padding:10px 12px;background:var(--sheet-2)}
.timeline li.goal.failed .goalbox{border:2px solid var(--poor)}
.timeline li.goal.passed .goalbox{border-color:var(--good)}
.criteria{list-style:none;padding:0;margin:4px 0 0;display:grid;gap:4px;font-size:14px}
.criteria li{display:flex;gap:8px;align-items:baseline}
.mark{font-weight:700}.mark.ok{color:var(--good)}.mark.no{color:var(--poor)}

/* tables */
.tablewrap{overflow-x:auto;background:var(--sheet);border:1px solid var(--line);border-radius:12px}
table{border-collapse:collapse;width:100%}
th,td{padding:9px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top;font-size:13.5px}
th{font-size:12px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em;background:var(--sheet-2)}
tr:last-child td{border-bottom:0}
td.good{color:var(--good)}td.poor{color:var(--poor);font-weight:600}td.needs-improvement{color:var(--ni)}
.mini{width:104px;max-height:74px;object-fit:cover;object-position:top;border:1px solid var(--line);border-radius:6px;display:block}
.history .bar{display:inline-block;height:8px;background:var(--brass-mark);border-radius:4px;vertical-align:middle;margin-right:6px}
.history tr.current td{font-weight:600}
.trend .spark{vertical-align:middle;color:var(--brass-mark);margin-right:6px}

/* compare */
.pairs{display:grid;gap:16px}
.pair{background:var(--sheet);border:1px solid var(--line);border-radius:12px;padding:12px 14px}
.pair h3{font-size:15px;font-family:inherit;font-weight:600;margin-bottom:8px;overflow-wrap:anywhere}
.pair .two{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.pair figure{margin:0;display:grid;gap:4px}
.pair figcaption{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.pair figure.after figcaption{color:var(--good)}
.pair img{width:100%;aspect-ratio:4/3;object-fit:cover;object-position:top;border:1px solid var(--line);border-radius:8px;display:block}
.verdict{font-weight:600}
.verdict.improved{color:var(--good)}.verdict.regressed{color:var(--poor)}

/* action bar + dialog */
.actionbar{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:30;background:var(--ink);color:var(--paper);border-radius:999px;padding:8px 8px 8px 18px;display:flex;align-items:center;gap:10px;box-shadow:0 10px 30px -10px rgba(0,0,0,.5);max-width:calc(100% - 24px)}
.actionbar[hidden]{display:none}
.actionbar .btn{background:var(--paper);color:var(--ink);border-color:var(--paper)}
.actionbar .btn.ghost{background:none;color:var(--paper);border-color:transparent}
.actionbar .n{font-weight:600;white-space:nowrap}
dialog{border:1px solid var(--line-2);border-radius:14px;padding:0;background:var(--sheet);color:var(--ink);width:min(920px,calc(100% - 24px));max-height:calc(100% - 32px);box-shadow:0 30px 80px -20px rgba(0,0,0,.55)}
dialog::backdrop{background:rgba(20,17,12,.55)}
.dlg{display:grid;gap:10px;padding:18px 20px}
.dlg-h{display:flex;justify-content:space-between;align-items:start;gap:12px}
.dlg-h p{margin:4px 0 0;color:var(--muted);font-size:13.5px;max-width:70ch}
.dlg textarea{width:100%;min-height:min(52vh,520px);resize:vertical;background:var(--paper);border:1px solid var(--line-2);border-radius:10px;padding:12px;font:12.5px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--ink)}
.dlg-f{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.dlg-f .status{font-size:13px;color:var(--muted);margin-left:auto}
.iconbtn{border:1px solid var(--line-2);background:none;border-radius:999px;width:34px;height:34px;cursor:pointer;font-size:18px;line-height:1;flex:none}

footer.foot{border-top:1px solid var(--line);padding:18px 0 90px;font-size:12.5px;color:var(--muted);text-align:center}
footer.foot svg{height:18px;width:auto;vertical-align:-3px;margin-right:6px;color:var(--ink)}

@media (max-width:720px){
  .wrap{padding:0 16px}
  .mast{position:relative}
  .mast-in{padding-top:10px;padding-bottom:4px;gap:10px}
  .brand svg{height:24px}
  .seg button{padding:4px 9px}
  #theme .lbl{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
  .hero{padding-top:22px}
  .brand-sub{display:none}
  .rc{display:block;position:relative;padding-left:0}
  .rc>.pick{position:absolute;left:14px;top:15px;padding:0}
  .rc>details>summary{padding:13px 14px 13px 44px}
  .body{padding:4px 14px 16px}
  .stats{flex-wrap:nowrap;gap:8px}
  .stats li{flex:1 1 0;min-width:0;padding:8px 10px 7px}
  .stats .v{font-size:20px}
  .stats .l{overflow-wrap:anywhere}
  dl.facts{grid-template-columns:1fr;gap:2px}
  dl.facts dd{margin-bottom:8px}
  .pair .two{grid-template-columns:1fr 1fr;gap:8px}
  .toolbar{position:static}
  .filters select{max-width:100%}
  .filters label{flex:1 1 140px}
  .cards,.blocked{grid-template-columns:1fr}
  .actionbar{left:12px;right:12px;transform:none;border-radius:16px;justify-content:space-between}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important;scroll-behavior:auto!important}}
@media print{.mast,.toolbar,.actionbar,.pick{display:none!important}.panel[hidden]{display:block!important}}
`;
