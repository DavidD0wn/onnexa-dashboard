"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function SimuladorRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/calculadora"); }, [router]);
  return null;
}
