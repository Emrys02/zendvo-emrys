"use client";

import React, { Suspense, useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuthContext } from "@/context/AuthContext";
import { AuthLayout } from "@/layouts/AuthLayout";
import { WorldMapShowcase } from "@/components/auth/WordMapShowcase";
import { Input } from "@/components/Input";
import { PasswordInput } from "@/components/PasswordInput";
import Button from "@/components/Button";

function LoginForm() {
  const REMEMBER_ME_KEY = "zendvo.rememberMe";
  const REMEMBERED_EMAIL_KEY = "zendvo.rememberedEmail";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  useEffect(() => {
    try {
      const storedRememberMe = localStorage.getItem(REMEMBER_ME_KEY) === "true";
      const storedEmail = localStorage.getItem(REMEMBERED_EMAIL_KEY);
      if (storedRememberMe) {
        setRememberMe(true);
      }
      if (storedEmail) {
        setEmail(storedEmail);
      }
    } catch (err) {
      console.warn("localStorage is not available", err);
    }
  }, []);
  const { login } = useAuthContext();
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      await login(email, password, rememberMe);
      const callbackUrl = searchParams.get("callbackUrl");
      const redirectTo =
        callbackUrl && callbackUrl.startsWith("/")
          ? callbackUrl
          : "/dashboard/sender";
      router.push(redirectTo);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-8 w-full">
      <div className="gap-2 flex flex-col">
        <h1 className="text-[32px] font-bold text-[#18181B] leading-tight tracking-tight">
          Login
        </h1>
        <p className="text-[13px] font-medium text-[#717182]">
          To start receiving cash gifts
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <p className="text-red-500 text-sm" role="alert">
            {error}
          </p>
        )}

        <Input
          id="email"
          label="Email address"
          type="email"
          placeholder="john123@gmail.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />

        <div className="space-y-3">
          <PasswordInput
            id="password"
            label="Password"
            placeholder="••••••••••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
          <div className="flex justify-end">
            <Link
              href="/forgot-password"
              className="text-[13px] font-bold text-[#5A45FE] hover:text-[#4b35e5] transition-colors"
            >
              Forgot password?
            </Link>
          </div>
        </div>

       <label className="flex items-center gap-2 cursor-pointer">
  <input
    type="checkbox"
    className="hidden peer"
    checked={rememberMe}
    onChange={(e) => setRememberMe(e.target.checked)}
  />

  <div className="w-4 h-4 border border-[#D4D4D8] rounded peer-checked:bg-[#5A45FE] peer-checked:border-[#5A45FE]" />

  <span className="text-[13px] font-medium text-[#18181B]">
    Remember Me
  </span>
</label>

        <div className="pt-2">
          <Button
            type="submit"
            variant="primary"
            className="w-full rounded-lg text-[15px] font-medium h-12"
            isLoading={isSubmitting}
          >
            Login
          </Button>
        </div>

        <p className="text-center text-[13px] font-medium text-[#18181B] pt-2">
          Not registered yet?{" "}
          <Link
            href="/auth/sign-up"
            className="text-[#5A45FE] font-bold transition-colors ml-1 hover:text-[#4b35e5]"
          >
            Sign Up
          </Link>
        </p>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <AuthLayout showcaseContent={<WorldMapShowcase />}>
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </AuthLayout>
  );
}
