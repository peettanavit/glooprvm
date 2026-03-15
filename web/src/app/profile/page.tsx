"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from "@heroui/react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import {
  subscribeToUserProfile,
  subscribeToUserSessions,
  uploadAvatar,
  updateUserProfile,
  type UserProfile,
  type UserSessionHistory,
} from "@/lib/user";

const AVATAR_PRESETS = [
  { id: "recycle", bg: "bg-green-400",   emoji: "♻️" },
  { id: "leaf",    bg: "bg-emerald-400", emoji: "🌿" },
  { id: "sprout",  bg: "bg-lime-400",    emoji: "🌱" },
  { id: "wave",    bg: "bg-blue-400",    emoji: "🌊" },
  { id: "sun",     bg: "bg-yellow-400",  emoji: "☀️" },
  { id: "flower",  bg: "bg-pink-400",    emoji: "🌸" },
  { id: "fire",    bg: "bg-orange-400",  emoji: "🔥" },
  { id: "star",    bg: "bg-purple-400",  emoji: "⭐" },
  { id: "frog",    bg: "bg-teal-400",    emoji: "🐸" },
  { id: "fox",     bg: "bg-red-400",     emoji: "🦊" },
  { id: "robot",   bg: "bg-slate-400",   emoji: "🤖" },
  { id: "butterfly", bg: "bg-violet-400", emoji: "🦋" },
];

const initialProfile: UserProfile = { total_score: 0, session_count: 0 };

function AvatarDisplay({
  profile,
  size = "lg",
}: {
  profile: UserProfile;
  size?: "lg" | "sm";
}) {
  const dim = size === "lg" ? "w-20 h-20 text-3xl" : "w-10 h-10 text-lg";

  if (profile.avatar_url) {
    return (
      <div className={`relative ${dim} rounded-full overflow-hidden border-2 border-green-200`}>
        <Image src={profile.avatar_url} alt="avatar" fill className="object-cover" unoptimized />
      </div>
    );
  }

  if (profile.avatar_preset) {
    const preset = AVATAR_PRESETS.find((p) => p.id === profile.avatar_preset);
    if (preset) {
      return (
        <div className={`${dim} rounded-full ${preset.bg} flex items-center justify-center border-2 border-white shadow-sm`}>
          <span>{preset.emoji}</span>
        </div>
      );
    }
  }

  return (
    <div className={`${dim} rounded-full bg-green-100 flex items-center justify-center border-2 border-green-200`}>
      <span className="text-green-400">
        {profile.nickname ? profile.nickname[0].toUpperCase() : "?"}
      </span>
    </div>
  );
}

export default function ProfilePage() {
  const router = useRouter();
  const [uid, setUid] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile>(initialProfile);
  const [sessions, setSessions] = useState<UserSessionHistory[]>([]);

  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const [editingNickname, setEditingNickname] = useState(false);
  const [nicknameInput, setNicknameInput] = useState("");
  const [savingNickname, setSavingNickname] = useState(false);

  const [profileError, setProfileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    let unsubscribeProfile: (() => void) | null = null;
    let unsubscribeSessions: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (unsubscribeProfile) { unsubscribeProfile(); unsubscribeProfile = null; }
      if (unsubscribeSessions) { unsubscribeSessions(); unsubscribeSessions = null; }

      if (!user) { router.replace("/login"); return; }

      setUid(user.uid);

      try {
        await user.getIdToken();
        if (cancelled) return;
        unsubscribeProfile = subscribeToUserProfile(user.uid, setProfile, () => router.replace("/login"));
        unsubscribeSessions = subscribeToUserSessions(user.uid, setSessions, () => router.replace("/login"));
      } catch {
        router.replace("/login");
      }
    });

    return () => {
      cancelled = true;
      unsubscribeAuth();
      if (unsubscribeProfile) unsubscribeProfile();
      if (unsubscribeSessions) unsubscribeSessions();
    };
  }, [router]);

  const openAvatarPicker = () => {
    setSelectedPreset(profile.avatar_preset ?? null);
    setProfileError(null);
    setShowAvatarPicker(true);
  };

  const handlePickerUpload = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !uid) return;

    if (!file.type.startsWith("image/")) {
      setProfileError("กรุณาเลือกไฟล์รูปภาพเท่านั้น");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setProfileError("ขนาดไฟล์ต้องไม่เกิน 5MB");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setUploadingAvatar(true);
    setProfileError(null);
    try {
      const url = await uploadAvatar(uid, file);
      await updateUserProfile(uid, { avatar_url: url, avatar_preset: "" });
      setShowAvatarPicker(false);
    } catch {
      setProfileError("อัปโหลดรูปไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setUploadingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSavePreset = async () => {
    if (!uid || !selectedPreset) return;
    setUploadingAvatar(true);
    try {
      await updateUserProfile(uid, { avatar_preset: selectedPreset, avatar_url: "" });
      setShowAvatarPicker(false);
    } catch {
      setProfileError("บันทึกไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleSaveNickname = async () => {
    if (!uid || !nicknameInput.trim()) return;
    setSavingNickname(true);
    setProfileError(null);
    try {
      await updateUserProfile(uid, { nickname: nicknameInput.trim() });
      setEditingNickname(false);
    } catch {
      setProfileError("บันทึกชื่อไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setSavingNickname(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg flex flex-col gap-4">
        <div className="text-center mb-2">
          <h1 className="text-2xl font-bold text-gray-800">โปรไฟล์ของฉัน</h1>
          <p className="text-gray-400 text-sm">ติดตามคะแนนและประวัติการรีไซเคิล</p>
        </div>

        {/* Avatar + Nickname */}
        <Card className="shadow-sm border border-green-100">
          <CardBody className="py-5 px-5">
            <div className="flex flex-col items-center gap-3">
              {/* Avatar button */}
              <div className="relative">
                <button onClick={openAvatarPicker} className="focus:outline-none">
                  <AvatarDisplay profile={profile} size="lg" />
                </button>
                <span className="absolute bottom-0 right-0 bg-green-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center pointer-events-none select-none">
                  +
                </span>
              </div>

              {/* Nickname */}
              {editingNickname ? (
                <div className="flex gap-2 items-center w-full max-w-xs">
                  <Input
                    size="sm"
                    placeholder="ชื่อเล่น"
                    value={nicknameInput}
                    onValueChange={setNicknameInput}
                    maxLength={20}
                    autoFocus
                    classNames={{ input: "text-center" }}
                  />
                  <Button size="sm" color="success" isLoading={savingNickname} onPress={handleSaveNickname}>
                    บันทึก
                  </Button>
                  <Button size="sm" variant="flat" onPress={() => setEditingNickname(false)}>
                    ยกเลิก
                  </Button>
                </div>
              ) : (
                <button
                  onClick={() => { setNicknameInput(profile.nickname ?? ""); setEditingNickname(true); }}
                  className="text-center group"
                >
                  <p className="text-base font-semibold text-gray-800 group-hover:text-green-600 transition-colors">
                    {profile.nickname ?? "ตั้งชื่อเล่น"}
                  </p>
                  <p className="text-xs text-gray-400 group-hover:text-green-400 transition-colors">
                    แตะเพื่อแก้ไข
                  </p>
                </button>
              )}
            </div>
          </CardBody>
        </Card>

        {profileError && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            <p className="text-red-600 text-sm">{profileError}</p>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3">
          <Card className="shadow-sm border border-green-100">
            <CardBody className="text-center py-5">
              <p className="text-3xl font-bold text-green-600">{profile.total_score}</p>
              <p className="text-gray-500 text-xs mt-1">คะแนนสะสมทั้งหมด</p>
            </CardBody>
          </Card>
          <Card className="shadow-sm border border-green-100">
            <CardBody className="text-center py-5">
              <p className="text-3xl font-bold text-blue-500">{profile.session_count}</p>
              <p className="text-gray-500 text-xs mt-1">เซสชันที่ผ่านมา</p>
            </CardBody>
          </Card>
        </div>

        {/* Session history */}
        <Card className="shadow-sm border border-green-100">
          <CardHeader className="pb-2 px-5 pt-4">
            <h2 className="text-base font-semibold text-gray-700">ประวัติการใช้งาน</h2>
          </CardHeader>
          <CardBody className="pt-0 px-5 pb-4">
            {sessions.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-4">ยังไม่มีประวัติการใช้งาน</p>
            ) : (
              <div className="flex flex-col gap-2">
                {sessions.map((session) => (
                  <div key={session.id} className="flex justify-between items-center py-3 border-b border-gray-100 last:border-0">
                    <div>
                      <p className="text-sm text-gray-700 font-medium">{session.machine_id}</p>
                      {session.completed_at && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          {session.completed_at.toDate().toLocaleDateString("th-TH", {
                            day: "numeric", month: "short", year: "numeric",
                            hour: "2-digit", minute: "2-digit",
                          })}
                        </p>
                      )}
                    </div>
                    <Chip color="success" variant="flat" size="sm">+{session.score} คะแนน</Chip>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        <div className="grid grid-cols-2 gap-3">
          <Button as={Link} href="/rewards" color="primary" variant="flat" className="font-medium">
            ดูของรางวัล
          </Button>
          <Button as={Link} href="/dashboard" variant="flat" className="font-medium">
            กลับหน้าหลัก
          </Button>
        </div>
      </div>

      {/* Avatar Picker Modal */}
      <Modal
        isOpen={showAvatarPicker}
        onClose={() => setShowAvatarPicker(false)}
        placement="center"
      >
        <ModalContent>
          <ModalHeader className="text-base">เลือกรูปโปรไฟล์</ModalHeader>
          <ModalBody className="pb-2">
            {/* Preset grid */}
            <p className="text-xs text-gray-400 mb-2">อวตารสำเร็จรูป</p>
            <div className="grid grid-cols-6 gap-2">
              {AVATAR_PRESETS.map((preset) => {
                const isSelected = selectedPreset === preset.id;
                return (
                  <button
                    key={preset.id}
                    onClick={() => setSelectedPreset(preset.id)}
                    className={`w-12 h-12 rounded-full ${preset.bg} flex items-center justify-center text-xl transition-all
                      ${isSelected ? "ring-2 ring-offset-2 ring-green-500 scale-110" : "opacity-80 hover:opacity-100 hover:scale-105"}`}
                  >
                    {preset.emoji}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-2 my-3">
              <div className="flex-1 h-px bg-gray-200" />
              <p className="text-xs text-gray-400">หรือ</p>
              <div className="flex-1 h-px bg-gray-200" />
            </div>

            {/* Upload option */}
            <button
              onClick={handlePickerUpload}
              disabled={uploadingAvatar}
              className="w-full py-3 rounded-xl border-2 border-dashed border-gray-200 hover:border-green-300 hover:bg-green-50 transition-colors text-sm text-gray-500 hover:text-green-600"
            >
              {uploadingAvatar ? "กำลังอัปโหลด..." : "📁  อัปโหลดรูปของตัวเอง"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
            />

            {profileError && (
              <p className="text-red-500 text-xs mt-1">{profileError}</p>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={() => setShowAvatarPicker(false)}>ยกเลิก</Button>
            <Button
              color="success"
              isDisabled={!selectedPreset}
              isLoading={uploadingAvatar}
              onPress={handleSavePreset}
            >
              บันทึก
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </main>
  );
}
