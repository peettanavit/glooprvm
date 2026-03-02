"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardBody, CardHeader, Input } from "@heroui/react";
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
            ? "Login failed"
            : "Register failed";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main>
      <Card style={{ width: "100%", maxWidth: 480 }}>
        <CardHeader>
          <h1 style={{ margin: 0 }}>
            {mode === "login" ? "Log In to Gloop" : "Register for Gloop"}
          </h1>
        </CardHeader>
        <CardBody>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <Button
              size="sm"
              color={mode === "login" ? "primary" : "default"}
              variant={mode === "login" ? "solid" : "flat"}
              onPress={() => setMode("login")}
            >
              Log In
            </Button>
            <Button
              size="sm"
              color={mode === "register" ? "primary" : "default"}
              variant={mode === "register" ? "solid" : "flat"}
              onPress={() => setMode("register")}
            >
              Register
            </Button>
          </div>
          <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
            <Input
              type="email"
              label="Email"
              value={email}
              onValueChange={setEmail}
              isRequired
            />
            <Input
              type="password"
              label="Password"
              value={password}
              onValueChange={setPassword}
              isRequired
            />
            {error ? (
              <p style={{ color: "#dc2626", margin: 0 }}>{error}</p>
            ) : null}
            <p style={{ margin: 0, fontSize: 14, color: "#4b5563" }}>
              {mode === "login"
                ? "After login, your recycling session will start automatically."
                : "After registration, your account will be signed in and session starts automatically."}
            </p>
            <Button color="primary" type="submit" isLoading={loading}>
              {mode === "login" ? "Log In" : "Create Account"}
            </Button>
          </form>
        </CardBody>
      </Card>
    </main>
  );
}
