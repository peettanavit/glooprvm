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

const labelByStatus: Record<MachineStatus, string> = {
  IDLE: "ว่าง",
  READY: "พร้อมรับขวด",
  PROCESSING: "กำลังประมวลผล",
  REJECTED: "ไม่รับขวด",
  COMPLETED: "เสร็จสิ้น",
};

const descByStatus: Record<MachineStatus, string> = {
  IDLE: "เครื่องว่างอยู่ รอผู้ใช้งาน",
  READY: "วางขวดให้ฉลากชัด แล้วกดถ่ายรูป",
  PROCESSING: "กำลังรับขวด รอสักครู่...",
  REJECTED: "ขวดไม่ผ่านการตรวจสอบ",
  COMPLETED: "เซสชันเสร็จสิ้น",
};

export function MachineStatusCard({ status, score }: { status: MachineStatus; score: number }) {
  return (
    <Card className="w-full shadow-md border border-green-100">
      <CardBody className="p-5">
        <div className="flex justify-between items-start mb-4">
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">สถานะเครื่อง</p>
            <Chip
              color={colorByStatus[status]}
              variant="flat"
              size="lg"
              classNames={{ content: "font-semibold text-sm" }}
            >
              {labelByStatus[status]}
            </Chip>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">คะแนนเซสชัน</p>
            <p className="text-3xl font-bold text-green-600">{score}</p>
          </div>
        </div>
        <p className="text-sm text-gray-500">{descByStatus[status]}</p>
      </CardBody>
    </Card>
  );
}
