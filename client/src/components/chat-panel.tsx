import { useState, useRef, useEffect, useCallback } from "react";
import { MessageCircle, Send, Sparkles, Lock, UserCheck, PhoneCall } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useTier } from "@/hooks/use-tier";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";

const HANDOFF_TOKEN = "[SUGGEST_HUMAN_HANDOFF]";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  suggestHandoff?: boolean;
}

export function ChatPanel() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [handoffRequested, setHandoffRequested] = useState(false);
  const [handoffPending, setHandoffPending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const { hasFeature } = useTier();

  const canUseChat = hasFeature("ai_assistant");

  const { data: handoffConfig } = useQuery<{ enabled: boolean }>({
    queryKey: ["/api/chat/handoff-enabled"],
    enabled: open && canUseChat,
    staleTime: Infinity,
  });

  const handoffEnabled = handoffConfig?.enabled ?? false;

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (open && canUseChat && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open, canUseChat]);

  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, []);

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
      setMessages([]);
      setInput("");
      setError(null);
      setIsStreaming(false);
      setHandoffRequested(false);
    }
    setOpen(isOpen);
  };

  const requestHandoff = async () => {
    if (handoffRequested || handoffPending) return;
    setHandoffPending(true);
    try {
      const res = await fetch("/api/chat/handoff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          messages: messages.map(m => ({ role: m.role, content: m.content })),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to notify team");
      }
      setHandoffRequested(true);
      setMessages(prev => [
        ...prev,
        {
          role: "assistant",
          content: "A member of our support team has been notified and will be in touch with you shortly. In the meantime, feel free to continue asking questions.",
        },
      ]);
    } catch (err: any) {
      setError(err.message || "Failed to contact support team");
    } finally {
      setHandoffPending(false);
    }
  };

  const sendMessage = async () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;

    setError(null);
    const userMessage: ChatMessage = { role: "user", content: trimmed };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput("");
    setIsStreaming(true);

    const assistantMessage: ChatMessage = { role: "assistant", content: "" };
    setMessages([...updatedMessages, assistantMessage]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        signal: controller.signal,
        body: JSON.stringify({
          messages: updatedMessages.map(m => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Error ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let accumulated = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") break;
          if (!data) continue;

          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              throw new Error(parsed.error);
            }
            if (parsed.content) {
              accumulated += parsed.content;
              const hasHandoffToken = accumulated.includes(HANDOFF_TOKEN);
              const cleanContent = accumulated.replace(HANDOFF_TOKEN, "").trim();
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  role: "assistant",
                  content: cleanContent,
                  suggestHandoff: hasHandoffToken,
                };
                return updated;
              });
            }
          } catch (e) {
            if (e instanceof SyntaxError) continue;
            throw e;
          }
        }
      }
    } catch (err: any) {
      if (err.name === "AbortError") return;
      setError(err.message || "Failed to get response");
      setMessages(prev => {
        if (prev.length > 0 && prev[prev.length - 1].role === "assistant" && prev[prev.length - 1].content === "") {
          return prev.slice(0, -1);
        }
        return prev;
      });
    } finally {
      setIsStreaming(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const aiSuggestsHandoff = messages.some(m => m.role === "assistant" && m.suggestHandoff);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-20 right-6 z-[60] h-14 w-14 rounded-full bg-[#f2690d] text-white shadow-lg flex items-center justify-center transition-transform hover:scale-105 active:scale-95"
        style={{ visibility: open ? "hidden" : "visible" }}
        data-testid="button-chat-open"
      >
        <MessageCircle className="h-6 w-6" />
      </button>

      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent
          side="right"
          className="w-[380px] sm:w-[380px] p-0 flex flex-col"
          data-testid="chat-panel"
        >
          <SheetHeader className="px-4 py-3 border-b bg-[#f2690d] text-white shrink-0">
            <SheetTitle className="flex items-center gap-2 text-white">
              <Sparkles className="h-5 w-5 shrink-0" />
              <span className="text-sm font-semibold">FNB Cost Pro AI</span>
            </SheetTitle>
          </SheetHeader>

          {!canUseChat ? (
            <div className="flex-1 flex items-center justify-center p-6">
              <div className="text-center space-y-4">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                  <Lock className="h-6 w-6 text-muted-foreground" />
                </div>
                <h3 className="font-semibold" data-testid="text-chat-upgrade-title">Upgrade to Basic</h3>
                <p className="text-sm text-muted-foreground" data-testid="text-chat-upgrade-description">
                  The AI assistant is available on the Basic plan and above. Get personalized cost management advice for your business.
                </p>
                <Link href="/choose-plan">
                  <Button className="bg-[#f2690d] hover:bg-[#d95a0b] text-white" data-testid="button-chat-upgrade">
                    View Plans
                  </Button>
                </Link>
              </div>
            </div>
          ) : (
            <>
              <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.length === 0 && (
                  <div className="text-center py-8 space-y-2">
                    <Sparkles className="h-8 w-8 mx-auto text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      Ask me about food costs, recipes, inventory management, or cost optimization strategies.
                    </p>
                  </div>
                )}

                {messages.map((msg, i) => (
                  <div key={i} className="space-y-2">
                    <div
                      className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                          msg.role === "user"
                            ? "bg-[#f2690d] text-white"
                            : "bg-muted text-foreground"
                        }`}
                        data-testid={`chat-message-${msg.role}-${i}`}
                      >
                        {msg.content}
                        {msg.role === "assistant" && msg.content === "" && isStreaming && (
                          <span className="inline-flex items-center gap-1">
                            <span className="h-1.5 w-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: "0ms" }} />
                            <span className="h-1.5 w-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: "150ms" }} />
                            <span className="h-1.5 w-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: "300ms" }} />
                          </span>
                        )}
                      </div>
                    </div>

                    {msg.role === "assistant" && msg.suggestHandoff && handoffEnabled && !handoffRequested && (
                      <div className="flex justify-start">
                        <div className="max-w-[85%] rounded-lg border bg-background px-3 py-2 text-sm space-y-2" data-testid="handoff-suggestion-card">
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <PhoneCall className="h-4 w-4 shrink-0" />
                            <span className="font-medium text-foreground">Need human support?</span>
                          </div>
                          <p className="text-muted-foreground text-xs">Our team can help with account-specific or complex requests.</p>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={requestHandoff}
                            disabled={handoffPending || isStreaming}
                            className="w-full"
                            data-testid="button-handoff-suggest"
                          >
                            {handoffPending ? "Notifying team..." : "Talk to a Human"}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {aiSuggestsHandoff && handoffEnabled && handoffRequested && (
                  <div className="flex justify-start">
                    <div className="max-w-[85%] rounded-lg border bg-background px-3 py-2 text-sm flex items-center gap-2 text-muted-foreground" data-testid="handoff-confirmed">
                      <UserCheck className="h-4 w-4 shrink-0 text-green-600" />
                      <span>Team notified</span>
                    </div>
                  </div>
                )}

                {error && (
                  <div className="text-center py-2">
                    <p className="text-sm text-destructive" data-testid="text-chat-error">{error}</p>
                  </div>
                )}
              </div>

              <div className="shrink-0 border-t p-3 space-y-2">
                {handoffEnabled && (
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={requestHandoff}
                      disabled={handoffRequested || handoffPending || isStreaming}
                      className="text-xs gap-1.5"
                      data-testid="button-chat-handoff"
                    >
                      <PhoneCall className="h-3 w-3" />
                      {handoffRequested ? "Notified" : handoffPending ? "Notifying..." : "Talk to a Human"}
                    </Button>
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask about your food costs..."
                    rows={1}
                    disabled={isStreaming}
                    className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring min-h-[36px] max-h-[100px]"
                    data-testid="input-chat-message"
                  />
                  <Button
                    size="icon"
                    onClick={sendMessage}
                    disabled={!input.trim() || isStreaming}
                    className="bg-[#f2690d] hover:bg-[#d95a0b] text-white shrink-0"
                    data-testid="button-chat-send"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
