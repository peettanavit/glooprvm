"use client";

import { FormEvent, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Button, Card, CardBody, Input } from "@heroui/react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { auth } from "@/lib/firebase";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await (
        mode === "login"
          ? await signInWithEmailAndPassword(auth, email, password)
          : await createUserWithEmailAndPassword(auth, email, password)
      );
      router.push("/dashboard");
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : mode === "login"
            ? "เข้าสู่ระบบล้มเหลว"
            : "สมัครสมาชิกล้มเหลว";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        {/* Logo / Header */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-2">
            <div className="bg-white rounded-2xl shadow-sm p-2 inline-flex">
              <Image src="/logo.jpg" alt="Gloop" width={110} height={110} className="rounded-xl" />
            </div>
          </div>
          <p className="text-gray-500 text-sm mt-1">เครื่องรับคืนขวดอัจฉริยะ</p>
        </div>

        <Card className="shadow-lg border border-green-100">
          <CardBody className="p-6">
            {/* Tab switcher */}
            <div className="flex gap-2 mb-6 p-1 bg-gray-100 rounded-xl">
              <button
                type="button"
                onClick={() => setMode("login")}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                  mode === "login"
                    ? "bg-white text-green-700 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                เข้าสู่ระบบ
              </button>
              <button
                type="button"
                onClick={() => setMode("register")}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                  mode === "register"
                    ? "bg-white text-green-700 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                สมัครสมาชิก
              </button>
            </div>

            <form onSubmit={onSubmit} className="flex flex-col gap-4">
              <Input
                type="email"
                label="อีเมล"
                placeholder="your@email.com"
                value={email}
                onValueChange={setEmail}
                isRequired
                variant="bordered"
                classNames={{ inputWrapper: "border-green-200 hover:border-green-400 focus-within:!border-green-500" }}
              />
              <Input
                type="password"
                label="รหัสผ่าน"
                value={password}
                onValueChange={setPassword}
                isRequired
                variant="bordered"
                classNames={{ inputWrapper: "border-green-200 hover:border-green-400 focus-within:!border-green-500" }}
              />

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                  <p className="text-red-600 text-sm">{error}</p>
                </div>
              )}

              <p className="text-xs text-gray-400 text-center">
                {mode === "login"
                  ? "หลังเข้าสู่ระบบ เซสชันรับขวดจะเริ่มต้นอัตโนมัติ"
                  : "หลังสมัครสมาชิก เซสชันรับขวดจะเริ่มต้นอัตโนมัติ"}
              </p>

              <Button
                color="primary"
                type="submit"
                isLoading={loading}
                className="w-full font-semibold"
                size="lg"
              >
                {mode === "login" ? "เข้าสู่ระบบ" : "สร้างบัญชีใหม่"}
              </Button>
            </form>
          </CardBody>
        </Card>
      </div>
    </main>
  );
}
