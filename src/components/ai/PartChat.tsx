import { ArrowUp, ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/** One line of the chat: a request, or what came of it */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  /**
   * An assistant reply's outcome: still working, changed the part, changed
   * and later undone, or failed (the part was left as it was)
   */
  status?: "pending" | "done" | "undone" | "failed";
  /** A quiet note under a reply, such as the credits it spent */
  note?: string;
}

interface PartChatProps {
  messages: ChatMessage[];
  /** A change is being made; the input waits until it lands */
  busy: boolean;
  /** Send a change request for the open part */
  onSend: (text: string) => void;
  /** Undo the change a reply made, putting the part back as it was before */
  onUndo: (id: string) => void;
  /** Clear the conversation (the part itself stays as it is) */
  onClear: () => void;
}

/** The pending reply's status, shown with a spinner */
const PENDING_LABEL = "Changing the part";

/**
 * A chat docked under the 3D view for changing the open part in plain words
 * ("make the ring thicker"). Each request edits the model in the editor in
 * place, so the next request builds on it, and the latest change can be
 * undone. Presentational: GeneratePanel owns the requests, auth, and billing
 */
const PartChat = ({
  messages,
  busy,
  onSend,
  onUndo,
  onClear,
}: PartChatProps) => {
  const [text, setText] = useState("");
  const [expanded, setExpanded] = useState(true);
  const threadRef = useRef<HTMLOListElement>(null);

  // Keep the newest line in view as the conversation grows
  const count = messages.length;
  const lastStatus = messages.at(-1)?.status;
  useEffect(() => {
    if (count === 0 && lastStatus === undefined) return;
    const thread = threadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [count, lastStatus]);

  // Only the newest change that landed can be undone, so an undo never skips
  // over a later change the user still sees
  const undoable = [...messages]
    .reverse()
    .find((m) => m.role === "assistant" && m.status === "done")?.id;

  const send = () => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    onSend(trimmed);
    setText("");
    setExpanded(true);
  };

  const showThread = expanded && messages.length > 0;

  return (
    <section className="part-chat" aria-label="Change this part">
      {messages.length > 0 ? (
        <div className="part-chat-bar">
          <button
            type="button"
            className="part-chat-icon"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={
              expanded ? "Hide the conversation" : "Show the conversation"
            }
            title={expanded ? "Hide the conversation" : "Show the conversation"}
          >
            {expanded ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
          </button>
          <button
            type="button"
            className="part-chat-icon"
            onClick={onClear}
            disabled={busy}
            aria-label="Clear the conversation"
            title="Clear the conversation"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ) : null}
      {showThread ? (
        <ol className="part-chat-thread" ref={threadRef} aria-live="polite">
          {messages.map((m) => (
            <li key={m.id} className="part-chat-line" data-role={m.role}>
              <span className="part-chat-bubble" data-status={m.status}>
                {m.status === "pending" ? (
                  <>
                    <span className="ai-job-spinner" aria-hidden="true" />
                    {PENDING_LABEL}
                  </>
                ) : (
                  m.text
                )}
              </span>
              {m.note || m.id === undoable ? (
                <span className="part-chat-meta">
                  {m.note ? <span>{m.note}</span> : null}
                  {m.id === undoable ? (
                    <button
                      type="button"
                      className="part-chat-undo"
                      onClick={() => onUndo(m.id)}
                      disabled={busy}
                    >
                      Undo
                    </button>
                  ) : null}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
      <form
        className="part-chat-input"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <textarea
          value={text}
          rows={1}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends; Shift+Enter starts a new line
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          placeholder="Ask for a change, like “make the ring thicker”"
          aria-label="Ask for a change to this part"
        />
        <button
          type="submit"
          className="part-chat-send"
          disabled={busy || text.trim().length === 0}
          aria-label="Send"
          title="Send"
        >
          <ArrowUp size={16} />
        </button>
      </form>
    </section>
  );
};

export default PartChat;
