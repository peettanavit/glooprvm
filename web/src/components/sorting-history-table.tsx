"use client";

import { Card, CardBody, CardHeader, Chip } from "@heroui/react";
import { type SortingLog } from "@/lib/machine";

export function SortingHistoryTable({ logs }: { logs: SortingLog[] }) {
  return (
    <Card className="shadow-sm border border-green-100">
      <CardHeader className="pb-2 px-5 pt-4">
        <h2 className="text-base font-semibold text-gray-700">ประวัติการคัดแยก (10 รายการล่าสุด)</h2>
      </CardHeader>
      <CardBody className="pt-0 px-5 pb-4">
        {logs.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-4">ยังไม่มีประวัติการคัดแยก</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-2 pr-4 text-xs text-gray-400 font-medium whitespace-nowrap">เวลา</th>
                  <th className="text-left py-2 pr-4 text-xs text-gray-400 font-medium">ประเภทขวด</th>
                  <th className="text-left py-2 text-xs text-gray-400 font-medium">เครื่อง</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-b border-gray-50 last:border-0">
                    <td className="py-2.5 pr-4 text-xs text-gray-500 whitespace-nowrap">
                      {log.sorted_at
                        ? log.sorted_at.toDate().toLocaleDateString("th-TH", {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "—"}
                    </td>
                    <td className="py-2.5 pr-4">
                      <Chip color="success" variant="flat" size="sm">
                        {log.bottle_type}
                      </Chip>
                    </td>
                    <td className="py-2.5 text-xs text-gray-500">{log.machine_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
