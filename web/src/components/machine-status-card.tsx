"use client";

import { Card, CardBody, Chip } from "@heroui/react";
import { type MachineStatus } from "@/types/machine";

const colorByStatus: Record<MachineStatus, "default" | "warning" | "success" | "danger" | "primary"> = {
  IDLE: "default",
  READY: "primary",
  PROCESSING: "warning",
  REJECTED: "danger",
  COMPLETED: "success",
};

export function MachineStatusCard({ status, score }: { status: MachineStatus; score: number }) {
  return (
    <Card style={{ width: "100%", maxWidth: 520 }}>
      <CardBody style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0 }}>Machine Status</h2>
          <Chip color={colorByStatus[status]}>{status}</Chip>
        </div>
        <p style={{ margin: 0 }}>Session Score: {score}</p>
      </CardBody>
    </Card>
  );
}
