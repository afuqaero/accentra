import { ChatWorkspace } from "../../components/chat-workspace";
export const dynamic = "force-dynamic";
export default function ChatPage() { return <main className="main"><div className="topbar"><div><div className="eyebrow">Grounded assistant</div><h1>Ask the books</h1><p className="page-subtitle">Upload a document, ask a question, and keep the conversation going.</p></div><a className="link" href="/">← Back to overview</a></div><ChatWorkspace /></main>; }
