import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

export const FEEDBACK_DURATION = 5000;

/** Scoped to the mounted reading space; late results cannot replace newer feedback. */
export function useFeedbackMessage() {
  const [feedback, setFeedback] = useState<{ id: number; text: string } | null>(null);
  const sequence = useRef(0);
  const active = useRef(true);
  const announced = useRef<number | null>(null);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  const showMessage = useCallback((text: string) => {
    if (active.current && text.trim()) setFeedback({ id: ++sequence.current, text });
  }, []);

  useEffect(() => {
    if (!feedback) return;
    let cancelled = false;
    const started = Date.now();
    const dismiss = () => {
      if (!cancelled) setFeedback(current => current?.id === feedback.id ? null : current);
    };
    let timer = setTimeout(dismiss, FEEDBACK_DURATION);

    // Announce without moving focus. No live region is added, avoiding two reads.
    if (announced.current !== feedback.id) {
      announced.current = feedback.id;
      try {
        if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibilityWithOptions(feedback.text, { queue: true });
        else AccessibilityInfo.announceForAccessibility(feedback.text);
      } catch { /* Visible feedback remains available without native announcements. */ }
    }

    if (Platform.OS === 'android') {
      try {
        void AccessibilityInfo.getRecommendedTimeoutMillis(FEEDBACK_DURATION).then(duration => {
          if (cancelled || !Number.isFinite(duration) || duration <= FEEDBACK_DURATION) return;
          clearTimeout(timer);
          const remaining = Math.max(0, Math.min(2147483647, started + duration - Date.now()));
          timer = setTimeout(dismiss, remaining);
        }).catch(() => { /* Retain the default duration if the native query fails. */ });
      } catch { /* Older native implementations can still show the message. */ }
    }
    return () => { cancelled = true; clearTimeout(timer); };
  }, [feedback]);

  return { message: feedback?.text ?? null, showMessage };
}
