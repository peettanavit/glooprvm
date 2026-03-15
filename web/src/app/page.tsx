import Image from "next/image";
import Link from "next/link";
import { Button } from "@heroui/react";

const steps = [
  {
    number: "1",
    title: "แสกน QR",
    description: "แสกน QR Code บนเครื่องเพื่อเริ่มเซสชัน",
  },
  {
    number: "2",
    title: "ใส่ขวด",
    description: "ใส่ขวดพลาสติกลงในช่องรับของเครื่อง",
  },
  {
    number: "3",
    title: "สะสมคะแนน",
    description: "รับคะแนนสะสมและแลกรางวัลได้ทันที",
  },
];

export default function LandingPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 py-16 bg-gradient-to-b from-green-50 to-white">
      <div className="w-full max-w-md flex flex-col items-center gap-8">

        {/* Logo + Brand */}
        <div className="flex flex-col items-center gap-4">
          <Image
            src="/logo.jpg"
            alt="Gloop logo"
            width={96}
            height={96}
            className="rounded-2xl shadow-md border border-green-100 object-cover"
            priority
          />
          <div className="text-center">
            <h1 className="text-4xl font-bold text-green-700 tracking-tight">Gloop</h1>
            <p className="text-gray-500 mt-1 text-base">เครื่องรับคืนขวดอัจฉริยะ</p>
          </div>
        </div>

        {/* How it works */}
        <div className="w-full flex flex-col gap-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest text-center">
            วิธีการใช้งาน
          </p>
          <div className="flex flex-col gap-3">
            {steps.map((step) => (
              <div
                key={step.number}
                className="flex items-start gap-4 bg-white rounded-2xl px-5 py-4 border border-green-100 shadow-sm"
              >
                <div className="w-9 h-9 rounded-full bg-green-600 flex items-center justify-center shrink-0">
                  <span className="text-white font-bold text-sm">{step.number}</span>
                </div>
                <div>
                  <p className="font-semibold text-gray-800 text-sm">{step.title}</p>
                  <p className="text-gray-500 text-xs mt-0.5">{step.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <Button
          as={Link}
          href="/login"
          color="success"
          size="lg"
          className="w-full font-bold text-white text-base rounded-2xl"
        >
          เริ่มใช้งาน
        </Button>

        <p className="text-xs text-gray-400 text-center -mt-3">
          ช่วยโลก ลดขยะ สะสมแต้ม
        </p>
      </div>
    </main>
  );
}
