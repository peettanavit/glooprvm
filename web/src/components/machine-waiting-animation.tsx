"use client";

import { Spinner } from "@heroui/react";

export function MachineWaitingAnimation() {
  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Spinner size="lg" />
      <span>Waiting for bottle...</span>
    </div>
  );
}
