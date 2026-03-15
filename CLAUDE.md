# Coding Standards – Gloop RVM

## React async effects with Firebase listeners

### Always use a `cancelled` flag in async `useEffect`

When a `useEffect` contains an `await` before setting up a subscription, the component may unmount during the `await`. Without a guard, the subscription is attached to a dead component, leaking memory and causing state updates on unmounted components.

```typescript
useEffect(() => {
  let cancelled = false;
  let unsubscribe: (() => void) | null = null;

  const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
    if (!user) { router.replace("/login"); return; }

    await user.getIdToken();
    if (cancelled) return; // guard: component may have unmounted during await

    unsubscribe = subscribeToSomething(...);
  });

  return () => {
    cancelled = true;
    unsubscribeAuth();
    if (unsubscribe) unsubscribe();
  };
}, []);
```

### Clean up the previous subscription before creating a new one

If `onAuthStateChanged` fires more than once with a user (e.g. on token refresh), always call the previous unsubscribe before assigning a new one.

```typescript
const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
  // Clean up previous listener first
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }

  if (!user) { ... }

  await user.getIdToken();
  if (cancelled) return;

  unsubscribe = subscribeToSomething(...);
});
```

### Return cleanup that sets `cancelled = true` AND calls unsubscribes

```typescript
return () => {
  cancelled = true;       // stop any in-flight async setup
  unsubscribeAuth();      // stop auth listener
  if (unsubscribe) unsubscribe(); // stop Firestore/RTDB listener
};
```

---

## Firestore transactions

### Generate all transaction-specific values inside the transaction callback

Firestore may retry a transaction on contention. Values generated outside the callback (document refs, random codes) are reused across retries — use stale IDs or duplicate codes.

```typescript
// BAD: code and ref created outside, reused on every retry
const ref = doc(collection(db, "col"));
const code = generateCode();
await runTransaction(db, async (tx) => {
  tx.set(ref, { code }); // same ref/code on every retry
});

// GOOD: generated inside, fresh on every retry
let committedCode = "";
await runTransaction(db, async (tx) => {
  const ref = doc(collection(db, "col"));
  const code = generateCode();
  committedCode = code;
  tx.set(ref, { code });
});
return committedCode;
```

---

## File uploads

### Validate file type and size client-side before uploading

The `accept` attribute on `<input>` is only a UI hint and can be bypassed.

```typescript
if (!file.type.startsWith("image/")) {
  setError("กรุณาเลือกไฟล์รูปภาพเท่านั้น");
  return;
}
if (file.size > 5 * 1024 * 1024) {
  setError("ขนาดไฟล์ต้องไม่เกิน 5MB");
  return;
}
```

---

## Error handling

### Differentiate user-facing errors by type

Don't show a generic message for every error. Check the message or error code and show context-appropriate text.

```typescript
} catch (err) {
  if (err instanceof Error && err.message === "คะแนนไม่เพียงพอ") {
    setError("คะแนนสะสมไม่เพียงพอสำหรับการแลกรางวัลนี้");
  } else {
    setError("เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
  }
}
```
