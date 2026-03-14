"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from "@heroui/react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { redeemReward, subscribeToUserProfile, subscribeToUserRedemptions, type UserProfile, type UserRedemptionHistory } from "@/lib/user";

const rewards = [
  { id: "coupon-10", name: "คูปองส่วนลด 10 บาท", cost: 50 },
  { id: "coupon-25", name: "คูปองส่วนลด 25 บาท", cost: 120 },
  { id: "eco-bag", name: "ถุงผ้า Gloop", cost: 180 },
  { id: "tumbler", name: "แก้วสแตนเลส Gloop", cost: 320 },
];

const initialProfile: UserProfile = {
  total_score: 0,
  session_count: 0,
};

export default function RewardsPage() {
  const router = useRouter();
  const [uid, setUid] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile>(initialProfile);
  const [redeeming, setRedeeming] = useState<string | null>(null);
  const [redeemCode, setRedeemCode] = useState<string | null>(null);
  const [redeemName, setRedeemName] = useState<string>("");
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [confirmReward, setConfirmReward] = useState<typeof rewards[0] | null>(null);
  const [redemptions, setRedemptions] = useState<UserRedemptionHistory[]>([]);

  useEffect(() => {
    let unsubscribeProfile: (() => void) | null = null;
    let unsubscribeRedemptions: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (unsubscribeProfile) { unsubscribeProfile(); unsubscribeProfile = null; }
      if (unsubscribeRedemptions) { unsubscribeRedemptions(); unsubscribeRedemptions = null; }

      if (!user) {
        router.replace("/login");
        return;
      }

      setUid(user.uid);

      try {
        await user.getIdToken();
        unsubscribeProfile = subscribeToUserProfile(user.uid, setProfile, () => router.replace("/login"));
        unsubscribeRedemptions = subscribeToUserRedemptions(user.uid, setRedemptions);
      } catch (error) {
        console.error("Failed to initialize rewards listener:", error);
        router.replace("/login");
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeProfile) unsubscribeProfile();
      if (unsubscribeRedemptions) unsubscribeRedemptions();
    };
  }, [router]);

  const availableCount = useMemo(
    () => rewards.filter((reward) => profile.total_score >= reward.cost).length,
    [profile.total_score],
  );

  const handleConfirmRedeem = async () => {
    if (!uid || !confirmReward) return;
    setRedeeming(confirmReward.id);
    setRedeemError(null);
    setConfirmReward(null);
    try {
      const code = await redeemReward(uid, confirmReward);
      setRedeemCode(code);
      setRedeemName(confirmReward.name);
    } catch (err) {
      setRedeemError(err instanceof Error ? err.message : "แลกไม่สำเร็จ");
    } finally {
      setRedeeming(null);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg flex flex-col gap-4">
        {/* Header */}
        <div className="text-center mb-2">
          <h1 className="text-2xl font-bold text-gray-800">ของรางวัล</h1>
          <p className="text-gray-400 text-sm">แลกคะแนนสะสมของคุณเป็นของรางวัล</p>
        </div>

        {/* Score summary */}
        <Card className="shadow-sm border border-green-100 bg-green-50">
          <CardBody className="py-4 px-5">
            <div className="flex justify-between items-center">
              <div>
                <p className="text-xs text-green-600 font-medium uppercase tracking-wider">คะแนนสะสมของคุณ</p>
                <p className="text-3xl font-bold text-green-700 mt-1">{profile.total_score}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-500">แลกได้แล้ว</p>
                <p className="text-2xl font-bold text-gray-700">{availableCount} รายการ</p>
              </div>
            </div>
          </CardBody>
        </Card>

        {redeemError && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            <p className="text-red-600 text-sm">{redeemError}</p>
          </div>
        )}

        {/* Rewards list */}
        <Card className="shadow-sm border border-green-100">
          <CardHeader className="pb-2 px-5 pt-4">
            <h2 className="text-base font-semibold text-gray-700">รายการของรางวัล</h2>
          </CardHeader>
          <CardBody className="pt-0 px-5 pb-4">
            <div className="flex flex-col gap-3">
              {rewards.map((reward) => {
                const canRedeem = profile.total_score >= reward.cost;
                const progress = Math.min((profile.total_score / reward.cost) * 100, 100);
                const remaining = Math.max(reward.cost - profile.total_score, 0);
                const isRedeeming = redeeming === reward.id;
                return (
                  <div
                    key={reward.id}
                    className={`py-3 px-3 rounded-xl border transition-colors ${
                      canRedeem ? "bg-green-50 border-green-200" : "bg-gray-50 border-gray-200"
                    }`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className={`text-sm font-medium ${canRedeem ? "text-gray-800" : "text-gray-500"}`}>
                          {reward.name}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {canRedeem ? `${reward.cost} คะแนน` : `อีก ${remaining} คะแนน`}
                        </p>
                      </div>
                      {canRedeem ? (
                        <Button
                          size="sm"
                          color="success"
                          variant="flat"
                          isLoading={isRedeeming}
                          onPress={() => setConfirmReward(reward)}
                          className="font-medium min-w-16"
                        >
                          แลก
                        </Button>
                      ) : (
                        <Chip color="default" variant="bordered" size="sm">ไม่พอ</Chip>
                      )}
                    </div>
                    {/* Progress bar */}
                    <div className="w-full bg-gray-200 rounded-full h-1.5">
                      <div
                        className={`h-1.5 rounded-full transition-all duration-500 ${
                          canRedeem ? "bg-green-500" : "bg-gray-400"
                        }`}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <p className="text-xs text-gray-400 mt-1 text-right">
                      {profile.total_score}/{reward.cost} คะแนน
                    </p>
                  </div>
                );
              })}
            </div>
          </CardBody>
        </Card>

        {/* Redemption history */}
        {redemptions.length > 0 && (
          <Card className="shadow-sm border border-purple-100">
            <CardHeader className="pb-2 px-5 pt-4">
              <h2 className="text-base font-semibold text-gray-700">ประวัติการแลก</h2>
            </CardHeader>
            <CardBody className="pt-0 px-5 pb-4">
              <div className="flex flex-col gap-2">
                {redemptions.map((r) => (
                  <div key={r.id} className="flex justify-between items-center py-2 border-b border-gray-100 last:border-0">
                    <div>
                      <p className="text-sm text-gray-700">{r.reward_name}</p>
                      <p className="text-xs font-mono text-purple-600 mt-0.5">{r.code}</p>
                      {r.redeemed_at && (
                        <p className="text-xs text-gray-400">
                          {r.redeemed_at.toDate().toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" })}
                        </p>
                      )}
                    </div>
                    <Chip color="secondary" variant="flat" size="sm">-{r.cost}</Chip>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Button as={Link} href="/profile" color="primary" variant="flat" className="font-medium">
            โปรไฟล์
          </Button>
          <Button as={Link} href="/dashboard" variant="flat" className="font-medium">
            กลับหน้าหลัก
          </Button>
        </div>
      </div>

      {/* Confirm modal */}
      <Modal isOpen={!!confirmReward} onClose={() => setConfirmReward(null)}>
        <ModalContent>
          <ModalHeader className="text-base">ยืนยันการแลกรางวัล</ModalHeader>
          <ModalBody>
            <p className="text-gray-700">
              แลก <strong>{confirmReward?.name}</strong> ใช้ <strong>{confirmReward?.cost} คะแนน</strong> ใช่ไหม?
            </p>
            <p className="text-sm text-gray-400">คะแนนจะถูกหักทันทีและไม่สามารถคืนได้</p>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={() => setConfirmReward(null)}>ยกเลิก</Button>
            <Button color="success" onPress={handleConfirmRedeem}>ยืนยัน</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Code modal */}
      <Modal isOpen={!!redeemCode} onClose={() => setRedeemCode(null)}>
        <ModalContent>
          <ModalHeader className="text-base">แลกรางวัลสำเร็จ!</ModalHeader>
          <ModalBody className="text-center py-4">
            <p className="text-gray-500 text-sm mb-3">{redeemName}</p>
            <div className="bg-green-50 border-2 border-green-200 rounded-2xl py-5 px-6">
              <p className="text-xs text-green-600 mb-1 tracking-wider">รหัสแลกรางวัล</p>
              <p className="text-3xl font-bold text-green-700 tracking-widest">{redeemCode}</p>
            </div>
            <p className="text-xs text-gray-400 mt-3">บันทึกรหัสนี้ไว้ แล้วแสดงต่อพนักงานเพื่อรับของรางวัล</p>
          </ModalBody>
          <ModalFooter>
            <Button color="primary" className="w-full" onPress={() => setRedeemCode(null)}>รับทราบ</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </main>
  );
}
