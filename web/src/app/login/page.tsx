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
    setError(null);

    if (!email.includes("@") || !email.includes(".")) {
      setError("รูปแบบอีเมลไม่ถูกต้อง เช่น example@email.com");
      return;
    }
    if (password.length < 6) {
      setError("รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร");
      return;
    }

    setLoading(true);
    try {
      await (
        mode === "login"
          ? await signInWithEmailAndPassword(auth, email, password)
          : await createUserWithEmailAndPassword(auth, email, password)
      );
      router.push("/dashboard");
    } catch (err) {
      const code = (err as { code?: string }).code ?? "";
      let message: string;
      if (code === "auth/invalid-credential" || code === "auth/user-not-found" || code === "auth/wrong-password") {
        message = "อีเมลหรือรหัสผ่านไม่ถูกต้อง";
      } else if (code === "auth/email-already-in-use") {
        message = "อีเมลนี้ถูกใช้งานแล้ว";
      } else if (code === "auth/weak-password") {
        message = "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร";
      } else if (code === "auth/invalid-email") {
        message = "รูปแบบอีเมลไม่ถูกต้อง เช่น example@email.com";
      } else if (code === "auth/too-many-requests") {
        message = "ลองใหม่อีกครั้งในภายหลัง (ล็อคอินผิดบ่อยเกินไป)";
      } else {
        message = mode === "login" ? "เข้าสู่ระบบล้มเหลว กรุณาลองใหม่" : "สมัครสมาชิกล้มเหลว กรุณาลองใหม่";
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-10 bg-[linear-gradient(135deg,#f0fdf4_0%,#f7fef9_50%,#ffffff_100%)]">
      <div className="w-full max-w-md">
        {/* Logo / Header */}
        <div className="flex flex-col items-center gap-4 mb-8">
          <div className="relative w-24 h-24 rounded-2xl overflow-hidden shadow-md border border-green-100">
            <Image src="/logo.jpg" alt="Gloop logo" fill className="object-cover" priority />
          </div>
          <div className="text-center">
            <h1 className="text-4xl font-bold text-green-700 tracking-tight">Gloop</h1>
            <p className="text-gray-500 mt-1 text-base">เครื่องรับคืนขวดอัจฉริยะ</p>
          </div>
        </div>

        <Card className="shadow-lg border border-green-100">
          <CardBody className="p-6">
            {/* Tab switcher */}
            <div className="flex gap-2 mb-6 p-1 bg-green-50 rounded-xl border border-green-100">
              <button
                type="button"
                onClick={() => { setMode("login"); setError(null); }}
                className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 ${
                  mode === "login"
                    ? "bg-green-600 text-white shadow-sm"
                    : "text-green-700 hover:bg-green-100"
                }`}
              >
                เข้าสู่ระบบ
              </button>
              <button
                type="button"
                onClick={() => { setMode("register"); setError(null); }}
                className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 ${
                  mode === "register"
                    ? "bg-green-600 text-white shadow-sm"
                    : "text-green-700 hover:bg-green-100"
                }`}
              >
                สมัครสมาชิก
              </button>
            </div>

            <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
              <Input
                type="text"
                label="อีเมล"
                placeholder="your@email.com"
                value={email}
                onValueChange={setEmail}
                variant="bordered"
                classNames={{ inputWrapper: "border-green-200 hover:border-green-400 focus-within:!border-green-500" }}
                onInvalid={(e) => e.preventDefault()}
              />
              <Input
                type="password"
                label="รหัสผ่าน"
                value={password}
                onValueChange={setPassword}
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
                color="success"
                type="submit"
                isLoading={loading}
                className="w-full font-semibold text-white"
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
