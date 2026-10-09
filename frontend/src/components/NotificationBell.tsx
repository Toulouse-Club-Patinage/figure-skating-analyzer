import { useState, useRef, useEffect } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api, AppNotification } from "../api/client";

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: countData } = useQuery({
    queryKey: ["notifications", "count"],
    queryFn: api.me.notifications.count,
    refetchInterval: 60_000,
  });

  const { data: notifications } = useQuery({
    queryKey: ["notifications", "list"],
    queryFn: () => api.me.notifications.list(),
    enabled: open,
  });

  const markRead = useMutation({
    mutationFn: (id: number) => api.me.notifications.markRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const markAllRead = useMutation({
    mutationFn: () => api.me.notifications.markAllRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const count = countData?.count ?? 0;

  function handleNotifClick(notif: AppNotification) {
    if (!notif.is_read) markRead.mutate(notif.id);
    setOpen(false);
    navigate(notif.link);
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen(!open)}
        className="relative text-on-surface-variant hover:text-on-surface transition-colors"
        aria-label="Notifications"
      >
        <span className="material-symbols-outlined text-2xl">notifications</span>
        {count > 0 && (
          <span className="absolute -top-1 -right-1 bg-error text-on-primary text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-surface-container-lowest rounded-xl shadow-lg z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <h3 className="font-headline font-bold text-sm text-on-surface">Notifications</h3>
            {count > 0 && (
              <button
                onClick={() => markAllRead.mutate()}
                className="text-xs text-primary hover:underline"
              >
                Tout marquer comme lu
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {!notifications || notifications.length === 0 ? (
              <p className="px-4 py-6 text-sm text-on-surface-variant text-center">
                Aucune notification
              </p>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => handleNotifClick(n)}
                  className={`w-full text-left px-4 py-3 hover:bg-surface-container transition-colors flex gap-3 items-start ${
                    !n.is_read ? "bg-primary/5" : ""
                  }`}
                >
                  <span className="material-symbols-outlined text-lg mt-0.5 shrink-0 text-primary">
                    {n.type === "review" ? "rate_review" : n.type === "competition" ? "emoji_events" : "warning"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm truncate ${!n.is_read ? "font-bold text-on-surface" : "text-on-surface-variant"}`}>
                      {n.title}
                    </p>
                    <p className={`text-xs text-on-surface-variant mt-0.5 ${n.type === "competition" ? "whitespace-pre-line" : "truncate"}`}>
                      {n.message}
                    </p>
                    {n.created_at && (
                      <p className="text-[10px] text-on-surface-variant mt-1">
                        {new Date(n.created_at.endsWith("Z") ? n.created_at : n.created_at + "Z").toLocaleDateString("fr-FR", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    )}
                  </div>
                  {!n.is_read && (
                    <span className="w-2 h-2 rounded-full bg-primary shrink-0 mt-2" />
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
