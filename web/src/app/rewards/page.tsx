"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card, CardBody, CardHeader, Chip } from "@heroui/react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { subscribeToUserProfile, type UserProfile } from "@/lib/user";

const rewards = [
  { id: "coupon-10", name: "10 THB Discount Coupon", cost: 50 },
  { id: "coupon-25", name: "25 THB Discount Coupon", cost: 120 },
  { id: "eco-bag", name: "Gloop Eco Bag", cost: 180 },
  { id: "tumbler", name: "Gloop Stainless Tumbler", cost: 320 },
];

const initialProfile: UserProfile = {
  total_score: 0,
  session_count: 0,
};

export default function RewardsPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile>(initialProfile);

  useEffect(() => {
    let unsubscribeProfile: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (unsubscribeProfile) {
        unsubscribeProfile();
        unsubscribeProfile = null;
      }

      if (!user) {
        router.replace("/login");
        return;
      }

      unsubscribeProfile = subscribeToUserProfile(user.uid, setProfile, () => router.replace("/login"));
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeProfile) {
        unsubscribeProfile();
      }
    };
  }, [router]);

  const availableCount = useMemo(
    () => rewards.filter((reward) => profile.total_score >= reward.cost).length,
    [profile.total_score],
  );

  return (
    <main>
      <section style={{ width: "100%", maxWidth: 640, display: "grid", gap: 12 }}>
        <Card>
          <CardHeader>
            <h1 style={{ margin: 0 }}>Rewards Catalog</h1>
          </CardHeader>
          <CardBody style={{ display: "grid", gap: 8 }}>
            <p style={{ margin: 0 }}>
              Your Total Score: <strong>{profile.total_score}</strong>
            </p>
            <p style={{ margin: 0 }}>
              Redeemable Now: <strong>{availableCount}</strong> reward(s)
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h2 style={{ margin: 0 }}>Available Rewards</h2>
          </CardHeader>
          <CardBody style={{ display: "grid", gap: 10 }}>
            {rewards.map((reward) => {
              const canRedeem = profile.total_score >= reward.cost;
              return (
                <div
                  key={reward.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    borderBottom: "1px solid #e5e7eb",
                    paddingBottom: 8,
                  }}
                >
                  <div>
                    <p style={{ margin: 0 }}>{reward.name}</p>
                    <p style={{ margin: 0, color: "#6b7280", fontSize: 14 }}>
                      Cost: {reward.cost} points
                    </p>
                  </div>
                  <Chip color={canRedeem ? "success" : "default"}>
                    {canRedeem ? "Eligible" : "Not enough"}
                  </Chip>
                </div>
              );
            })}
          </CardBody>
        </Card>

        <p style={{ margin: 0, color: "#6b7280", fontSize: 14 }}>
          Next step: connect this catalog to a real redeem workflow and reduce points after confirmation.
        </p>

        <div style={{ display: "flex", gap: 8 }}>
          <Button as={Link} href="/profile" color="primary" variant="flat">
            View Profile
          </Button>
          <Button as={Link} href="/dashboard" variant="flat">
            Back to Machine
          </Button>
        </div>
      </section>
    </main>
  );
}
