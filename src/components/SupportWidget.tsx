import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  createSupportTicket,
  getUserSupportTickets,
  getSupportTicketMessages,
  sendSupportMessage,
  type SupportTicket,
  type SupportMessage,
} from '../lib/supabase';

type PanelView = 'home' | 'new-ticket' | 'my-tickets' | 'thread';

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) +
    ' · ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

const STATUS_BADGE: Record<string, string> = {
  open: '#22c55e',
  in_progress: '#f59e0b',
  closed: '#6b7280',
};

const STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  closed: 'Closed',
};

export default function SupportWidget() {
  const { user, isAdmin } = useAuth();

  // Don't render for admins or unauthenticated
  if (!user || isAdmin) return null;

  return <SupportWidgetInner user={user} />;
}

function SupportWidgetInner({ user }: { user: { id: string; email?: string } }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<PanelView>('home');
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [loadingTickets, setLoadingTickets] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);

  // Drag and drop state
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const isDraggingRef = useRef(false);
  const hasDraggedRef = useRef(false);
  const dragStartRef = useRef<{ clientX: number; clientY: number; initialX: number; initialY: number }>({ clientX: 0, clientY: 0, initialX: 0, initialY: 0 });

  // New ticket form
  const [subject, setSubject] = useState('');
  const [firstMessage, setFirstMessage] = useState('');
  const [formError, setFormError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  // Reply form
  const [reply, setReply] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const startDrag = (clientX: number, clientY: number) => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    dragStartRef.current = {
      clientX,
      clientY,
      initialX: rect.left,
      initialY: rect.top,
    };
    isDraggingRef.current = true;
    hasDraggedRef.current = false;
  };

  const onDragMove = (clientX: number, clientY: number) => {
    if (!isDraggingRef.current) return;
    const dx = clientX - dragStartRef.current.clientX;
    const dy = clientY - dragStartRef.current.clientY;

    if (Math.hypot(dx, dy) > 4) {
      hasDraggedRef.current = true;
    }

    const btnWidth = 58;
    const btnHeight = 58;
    const padding = 10;

    const newX = Math.max(padding, Math.min(window.innerWidth - btnWidth - padding, dragStartRef.current.initialX + dx));
    const newY = Math.max(padding, Math.min(window.innerHeight - btnHeight - padding, dragStartRef.current.initialY + dy));

    setPos({ x: newX, y: newY });
  };

  const endDrag = () => {
    isDraggingRef.current = false;
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingRef.current) {
        onDragMove(e.clientX, e.clientY);
      }
    };
    const handleMouseUp = () => {
      endDrag();
    };
    const handleTouchMove = (e: TouchEvent) => {
      if (isDraggingRef.current && e.touches[0]) {
        onDragMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    };
    const handleTouchEnd = () => {
      endDrag();
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('touchend', handleTouchEnd);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node) && buttonRef.current && !buttonRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Scroll to bottom of messages
  useEffect(() => {
    if (view === 'thread' && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, view]);

  async function loadTickets() {
    setLoadingTickets(true);
    try {
      const data = await getUserSupportTickets(user.id);
      setTickets(data);
    } catch {
      /* silent */
    } finally {
      setLoadingTickets(false);
    }
  }

  async function openThread(ticket: SupportTicket) {
    setSelectedTicket(ticket);
    setView('thread');
    setLoadingMessages(true);
    try {
      const msgs = await getSupportTicketMessages(ticket.id);
      setMessages(msgs);
    } catch {
      /* silent */
    } finally {
      setLoadingMessages(false);
    }
  }

  async function handleCreateTicket(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    if (!subject.trim() || !firstMessage.trim()) {
      setFormError('Please fill in both fields.');
      return;
    }
    setSending(true);
    try {
      await createSupportTicket(user.id, user.email || '', subject.trim(), firstMessage.trim());
      setSubmitted(true);
      setSubject('');
      setFirstMessage('');
    } catch (err: any) {
      setFormError(err?.message || 'Failed to submit ticket. Please try again.');
    } finally {
      setSending(false);
    }
  }

  async function handleSendReply(e: React.FormEvent) {
    e.preventDefault();
    if (!reply.trim() || !selectedTicket) return;
    setSending(true);
    try {
      await sendSupportMessage(selectedTicket.id, user.id, reply.trim(), false);
      setReply('');
      const msgs = await getSupportTicketMessages(selectedTicket.id);
      setMessages(msgs);
    } catch {
      /* silent */
    } finally {
      setSending(false);
    }
  }

  function handleOpen() {
    if (hasDraggedRef.current) {
      hasDraggedRef.current = false;
      return;
    }
    setOpen((prev) => !prev);
    if (!open) {
      setView('home');
      setSubmitted(false);
      setFormError('');
    }
  }

  function goToMyTickets() {
    setView('my-tickets');
    loadTickets();
  }

  return (
    <>
      {/* Floating Button */}
      <button
        ref={buttonRef}
        id="support-widget-btn"
        onClick={handleOpen}
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          startDrag(e.clientX, e.clientY);
        }}
        onTouchStart={(e) => {
          if (e.touches[0]) {
            startDrag(e.touches[0].clientX, e.touches[0].clientY);
          }
        }}
        aria-label="Customer Support"
        title="Drag to move, click for support"
        style={{
          position: 'fixed',
          ...(pos
            ? { left: `${pos.x}px`, top: `${pos.y}px`, bottom: 'auto', right: 'auto' }
            : { bottom: '4.75rem', right: '1.75rem' }),
          zIndex: 9000,
          width: '58px',
          height: '58px',
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
          boxShadow: open
            ? '0 0 0 4px rgba(99,102,241,0.3), 0 8px 32px rgba(99,102,241,0.5)'
            : '0 4px 24px rgba(99,102,241,0.45)',
          border: 'none',
          cursor: isDraggingRef.current ? 'grabbing' : 'grab',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: isDraggingRef.current ? 'none' : 'box-shadow 0.25s, transform 0.2s',
          transform: open ? 'scale(1.08) rotate(15deg)' : 'scale(1)',
          userSelect: 'none',
          touchAction: 'none',
        }}
        onMouseEnter={e => {
          if (!open && !isDraggingRef.current) (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.1)';
        }}
        onMouseLeave={e => {
          if (!open && !isDraggingRef.current) (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)';
        }}
      >
        {open ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        ) : (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        )}
      </button>

      {/* Unread pulse dot */}
      {!open && (
        <span style={{
          position: 'fixed',
          ...(pos
            ? { left: `${pos.x + 42}px`, top: `${pos.y - 2}px`, bottom: 'auto', right: 'auto' }
            : { bottom: '5.6rem', right: '1.75rem' }),
          zIndex: 9001,
          width: '14px', height: '14px',
          background: '#f43f5e',
          borderRadius: '50%',
          border: '2px solid var(--bg, #0f0f14)',
          animation: 'support-pulse 2s infinite',
          pointerEvents: 'none',
        }} />
      )}

      {/* Panel */}
      {open && (
        <div
          ref={panelRef}
          id="support-widget-panel"
          style={{
            position: 'fixed',
            ...(pos
              ? {
                  ...(pos.x < window.innerWidth / 2
                    ? { left: `${Math.max(10, pos.x)}px`, right: 'auto' }
                    : { right: `${Math.max(10, window.innerWidth - pos.x - 58)}px`, left: 'auto' }),
                  ...(pos.y > 320
                    ? { bottom: `${Math.max(10, window.innerHeight - pos.y + 10)}px`, top: 'auto', maxHeight: `${Math.min(580, pos.y - 20)}px` }
                    : { top: `${Math.max(10, pos.y + 68)}px`, bottom: 'auto', maxHeight: `${Math.min(580, window.innerHeight - pos.y - 80)}px` })
                }
              : {
                  bottom: '8.5rem',
                  right: '1.75rem',
                  maxHeight: 'calc(100vh - 10rem)',
                }),
            zIndex: 8999,
            width: 'min(400px, calc(100vw - 2rem))',
            borderRadius: '24px',
            background: 'rgba(16, 16, 22, 0.92)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            animation: 'support-slide-up 0.28s cubic-bezier(0.34,1.56,0.64,1)',
          }}
        >
          {/* Header */}
          <div style={{
            padding: '1.25rem 1.5rem',
            background: 'linear-gradient(135deg, rgba(99,102,241,0.18) 0%, rgba(139,92,246,0.12) 100%)',
            borderBottom: '1px solid rgba(255,255,255,0.07)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            flexShrink: 0,
          }}>
            {view !== 'home' && (
              <button
                onClick={() => {
                  if (view === 'thread') setView('my-tickets');
                  else { setView('home'); setSubmitted(false); setFormError(''); }
                }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.6)', padding: '0.2rem', display: 'flex' }}
                aria-label="Back"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
            )}
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, color: '#fff', fontSize: '0.95rem', lineHeight: 1.2 }}>
                {view === 'home' && 'Support Center'}
                {view === 'new-ticket' && 'New Support Ticket'}
                {view === 'my-tickets' && 'My Tickets'}
                {view === 'thread' && (selectedTicket?.subject ?? 'Ticket Thread')}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.45)', marginTop: '0.15rem' }}>
                {view === 'home' && 'How can we help you today?'}
                {view === 'new-ticket' && "Describe your issue and we'll get back to you"}
                {view === 'my-tickets' && `${tickets.length} ticket${tickets.length !== 1 ? 's' : ''}`}
                {view === 'thread' && selectedTicket && (
                  <span style={{ color: STATUS_BADGE[selectedTicket.status] || '#6b7280', fontWeight: 600 }}>
                    {STATUS_LABEL[selectedTicket.status] ?? selectedTicket.status}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Body */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1.5rem', minHeight: 0 }}>

            {/* HOME VIEW */}
            {view === 'home' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <p style={{ margin: '0 0 0.5rem', color: 'rgba(255,255,255,0.5)', fontSize: '0.82rem', lineHeight: 1.6 }}>
                  Our support team is ready to help. Create a ticket or check your existing requests.
                </p>
                <button
                  id="support-new-ticket-btn"
                  onClick={() => { setView('new-ticket'); setSubmitted(false); }}
                  style={homeBtnStyle('#6366f1', '#8b5cf6')}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  Start a New Ticket
                </button>
                <button
                  id="support-my-tickets-btn"
                  onClick={goToMyTickets}
                  style={homeBtnStyle('rgba(255,255,255,0.06)', 'rgba(255,255,255,0.06)', 'rgba(255,255,255,0.8)')}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
                  </svg>
                  View My Tickets
                </button>

                <div style={{ marginTop: '0.75rem', padding: '1rem', borderRadius: '14px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.35)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600 }}>Response Time</div>
                  <div style={{ fontSize: '0.88rem', color: 'rgba(255,255,255,0.7)' }}>⏱ Usually within <strong style={{ color: '#a78bfa' }}>24 hours</strong></div>
                </div>
              </div>
            )}

            {/* NEW TICKET VIEW */}
            {view === 'new-ticket' && (
              submitted ? (
                <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
                  <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>✅</div>
                  <div style={{ color: '#fff', fontWeight: 700, fontSize: '1.05rem', marginBottom: '0.35rem' }}>Ticket Submitted!</div>
                  <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.85rem', lineHeight: 1.6, marginBottom: '1.25rem' }}>
                    We have received your request and will reply shortly.
                  </div>
                  <button
                    onClick={goToMyTickets}
                    style={{ ...homeBtnStyle('#6366f1', '#8b5cf6'), width: '100%' }}
                  >
                    View My Tickets
                  </button>
                </div>
              ) : (
                <form onSubmit={handleCreateTicket} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                  <div>
                    <label style={labelStyle}>Subject *</label>
                    <input
                      id="support-subject-input"
                      style={inputStyle}
                      value={subject}
                      onChange={e => setSubject(e.target.value)}
                      placeholder="e.g. Payment issue, Coupon not working..."
                      required
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Describe your issue *</label>
                    <textarea
                      id="support-message-input"
                      style={{ ...inputStyle, minHeight: '110px', resize: 'vertical' }}
                      value={firstMessage}
                      onChange={e => setFirstMessage(e.target.value)}
                      placeholder="Please provide as much detail as possible..."
                      required
                    />
                  </div>
                  {formError && (
                    <div style={{ color: '#f87171', fontSize: '0.8rem', padding: '0.6rem 0.75rem', background: 'rgba(248,113,113,0.1)', borderRadius: '8px' }}>
                      {formError}
                    </div>
                  )}
                  <button
                    id="support-submit-btn"
                    type="submit"
                    disabled={sending}
                    style={{ ...homeBtnStyle('#6366f1', '#8b5cf6'), opacity: sending ? 0.7 : 1 }}
                  >
                    {sending ? 'Submitting...' : 'Submit Ticket'}
                  </button>
                </form>
              )
            )}

            {/* MY TICKETS VIEW */}
            {view === 'my-tickets' && (
              loadingTickets ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem 0' }}>
                  <div className="spinner" />
                </div>
              ) : tickets.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '1.5rem 0', color: 'rgba(255,255,255,0.4)' }}>
                  <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📭</div>
                  <div style={{ fontSize: '0.9rem' }}>No tickets yet.</div>
                  <button
                    onClick={() => { setView('new-ticket'); setSubmitted(false); }}
                    style={{ ...homeBtnStyle('#6366f1', '#8b5cf6'), marginTop: '1rem' }}
                  >
                    Create your first ticket
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                  {tickets.map(ticket => (
                    <button
                      key={ticket.id}
                      onClick={() => openThread(ticket)}
                      style={{
                        background: 'rgba(255,255,255,0.04)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: '14px',
                        padding: '0.9rem 1rem',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'background 0.15s',
                        width: '100%',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'flex-start' }}>
                        <div style={{ color: '#fff', fontWeight: 600, fontSize: '0.88rem', flex: 1, lineHeight: 1.3 }}>
                          {ticket.subject}
                        </div>
                        <span style={{
                          fontSize: '0.7rem',
                          fontWeight: 700,
                          color: STATUS_BADGE[ticket.status] ?? '#6b7280',
                          background: `${STATUS_BADGE[ticket.status] ?? '#6b7280'}22`,
                          padding: '0.2rem 0.55rem',
                          borderRadius: '99px',
                          whiteSpace: 'nowrap',
                          flexShrink: 0,
                        }}>
                          {STATUS_LABEL[ticket.status] ?? ticket.status}
                        </span>
                      </div>
                      <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.75rem', marginTop: '0.35rem' }}>
                        {formatTime(ticket.updated_at)}
                      </div>
                    </button>
                  ))}
                </div>
              )
            )}

            {/* THREAD VIEW */}
            {view === 'thread' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
                {loadingMessages ? (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem 0' }}>
                    <div className="spinner" />
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem' }}>
                    {messages.map(msg => (
                      <div
                        key={msg.id}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: msg.is_admin ? 'flex-start' : 'flex-end',
                        }}
                      >
                        <div style={{
                          maxWidth: '85%',
                          background: msg.is_admin
                            ? 'rgba(99,102,241,0.15)'
                            : 'rgba(255,255,255,0.07)',
                          border: msg.is_admin
                            ? '1px solid rgba(99,102,241,0.3)'
                            : '1px solid rgba(255,255,255,0.08)',
                          borderRadius: msg.is_admin ? '4px 14px 14px 14px' : '14px 4px 14px 14px',
                          padding: '0.65rem 0.9rem',
                        }}>
                          <div style={{ fontSize: '0.73rem', color: msg.is_admin ? '#a78bfa' : 'rgba(255,255,255,0.4)', marginBottom: '0.3rem', fontWeight: 600 }}>
                            {msg.is_admin ? '🛡 Support Agent' : '👤 You'}
                          </div>
                          <div style={{ color: '#f1f1f5', fontSize: '0.85rem', lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            {msg.message}
                          </div>
                          <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.3)', marginTop: '0.35rem', textAlign: 'right' }}>
                            {formatTime(msg.created_at)}
                          </div>
                        </div>
                      </div>
                    ))}
                    <div ref={messagesEndRef} />
                  </div>
                )}

                {selectedTicket?.status !== 'closed' ? (
                  <form onSubmit={handleSendReply} style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
                    <input
                      id="support-reply-input"
                      style={{ ...inputStyle, flex: 1, margin: 0, padding: '0.65rem 0.9rem' }}
                      value={reply}
                      onChange={e => setReply(e.target.value)}
                      placeholder="Type your reply..."
                      disabled={sending}
                    />
                    <button
                      id="support-reply-send-btn"
                      type="submit"
                      disabled={sending || !reply.trim()}
                      style={{
                        background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                        border: 'none',
                        borderRadius: '10px',
                        padding: '0 1rem',
                        cursor: 'pointer',
                        color: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        opacity: (sending || !reply.trim()) ? 0.6 : 1,
                        transition: 'opacity 0.2s',
                        flexShrink: 0,
                      }}
                      aria-label="Send reply"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                      </svg>
                    </button>
                  </form>
                ) : (
                  <div style={{ textAlign: 'center', padding: '0.75rem', background: 'rgba(107,114,128,0.1)', borderRadius: '10px', color: 'rgba(255,255,255,0.4)', fontSize: '0.82rem' }}>
                    This ticket is closed.{' '}
                    <button
                      onClick={() => { setView('new-ticket'); setSubmitted(false); }}
                      style={{ background: 'none', border: 'none', color: '#a78bfa', cursor: 'pointer', fontWeight: 600 }}
                    >
                      Open a new one?
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div style={{
            padding: '0.7rem 1.5rem',
            borderTop: '1px solid rgba(255,255,255,0.06)',
            background: 'rgba(0,0,0,0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.4rem',
            flexShrink: 0,
          }}>
            <span style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.25)' }}>
              🔒 Secured · CouponVault Support
            </span>
          </div>
        </div>
      )}

      {/* CSS animations */}
      <style>{`
        @keyframes support-slide-up {
          from { opacity: 0; transform: translateY(20px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes support-pulse {
          0%,100% { transform: scale(1); opacity: 1; }
          50%      { transform: scale(1.3); opacity: 0.6; }
        }
      `}</style>
    </>
  );
}

function homeBtnStyle(from: string, to: string, color = '#fff'): React.CSSProperties {
  return {
    width: '100%',
    padding: '0.85rem 1.25rem',
    borderRadius: '14px',
    background: `linear-gradient(135deg, ${from}, ${to})`,
    border: '1px solid rgba(255,255,255,0.08)',
    color,
    fontWeight: 600,
    fontSize: '0.88rem',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '0.6rem',
    justifyContent: 'center',
    transition: 'opacity 0.2s',
  };
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '12px',
  padding: '0.7rem 0.9rem',
  color: '#f1f1f5',
  fontSize: '0.85rem',
  outline: 'none',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
  lineHeight: 1.5,
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  color: 'rgba(255,255,255,0.5)',
  fontSize: '0.78rem',
  marginBottom: '0.4rem',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
};
