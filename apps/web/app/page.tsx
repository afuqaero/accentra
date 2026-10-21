import { UploadCard } from "../components/upload-card";
import { BookChat } from "../components/book-chat";

const queue = [
  { name: "INV-2026-1048.pdf", vendor: "Tenaga Supplies Sdn Bhd", meta: "Uploaded 8 min ago · 2 pages", amount: "RM 4,200.00", status: "Needs review", tone: "amber" },
  { name: "Maybank-statement-Sep.xlsx", vendor: "Maybank · September 2026", meta: "Uploaded 24 min ago · 1 sheet", amount: "RM 18,430.25", status: "Processing", tone: "green" },
  { name: "PV-00391.jpg", vendor: "Kencana Office Systems", meta: "Uploaded yesterday · 1 page", amount: "RM 860.00", status: "Ready to post", tone: "green" },
];

export default function Home() {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">accentra<span>·</span>ai</div>
        <nav className="nav" aria-label="Main navigation">
          <a className="active" href="#dashboard">Overview</a><a href="#inbox">Inbox <small>12</small></a><a href="/post-queue">Post queue</a><a href="/chat">Ask the books</a><a href="#reports">Reports</a><a href="#settings">Settings</a>
        </nav>
        <div className="tenant"><strong>Horizon & Co.</strong>Cloud Accounting · Live book<br />Last sync 11 minutes ago</div>
      </aside>
      <main className="main" id="dashboard">
        <header className="topbar"><div><div className="eyebrow">Wednesday, 21 October 2026</div><h1>Good morning, Aina</h1></div><div className="user"><span>Reviewer · Horizon &amp; Co.</span><div className="avatar">AN</div></div></header>
        <section className="grid stats" aria-label="Book summary">
          <div className="card stat"><span className="label">Needs your review</span><span className="value">12</span><span className="delta">3 high confidence · 9 to check</span></div>
          <div className="card stat"><span className="label">Ready to post</span><span className="value">7</span><span className="delta">RM 24,810.00 total</span></div>
          <div className="card stat"><span className="label">Posted this month</span><span className="value">184</span><span className="delta">↑ 12% vs September</span></div>
          <div className="card stat"><span className="label">Book health</span><span className="value">Good</span><span className="delta">No unreconciled records</span></div>
        </section>
        <section className="grid workspace">
          <div className="card section" id="inbox"><div className="section-head"><h2>Review queue</h2><a className="link" href="#queue">View all →</a></div><div className="queue">{queue.map((item) => <div className="queue-row" key={item.name}><div><div className="doc-title">{item.name}</div><div className="doc-meta">{item.vendor} · {item.meta}</div></div><span className={`pill ${item.tone}`}>{item.status}</span><span className="amount">{item.amount}</span></div>)}</div><p className="footer-note">AI suggestions are advisory. Nothing posts until a reviewer approves it.</p></div>
          <div className="grid"><UploadCard /><div className="card section" id="chat"><div className="section-head"><h2>One thing to know</h2><a className="link" href="#chat">Ask the books →</a></div><div className="insight"><strong>Utilities are up 8.4% this month</strong><p>Driven by three invoices from Tenaga Supplies. Each figure is linked to the posted books.</p></div><div className="insight"><strong>One vendor needs attention</strong><p>Bank details on INV-2026-1048 differ from the vendor master. Review before posting.</p></div><BookChat /></div></div>
        </section>
      </main>
    </div>
  );
}
