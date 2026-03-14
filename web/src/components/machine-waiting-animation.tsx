"use client";

import { Spinner } from "@heroui/react";

export function MachineWaitingAnimation() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-6">
      <Spinner size="lg" color="success" />
      <p className="text-gray-500 text-sm">กำลังรอการใส่ขวด...</p>
    </div>
  );
}
