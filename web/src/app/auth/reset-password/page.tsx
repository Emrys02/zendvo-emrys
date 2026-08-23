'use client'
import React, { useState, FormEvent, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AuthLayout } from '@/layouts/AuthLayout';
import { WorldMapShowcase } from '@/components/auth/WordMapShowcase';
import { PasswordInput } from '@/components/PasswordInput';
import Button from '@/components/Button';
import PasswordStrengthIndicator from '@/components/auth/PasswordStrengthIndicator';

const ResetPasswordPage: React.FC = () => {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);

  const calculateStrength = (pwd: string): 0 | 1 | 2 | 3 | 4 => {
    if (!pwd) return 0;
    let score = 0;
    if (pwd.length >= 8) score++;
    if (/[A-Z]/.test(pwd)) score++;
    if (/[a-z]/.test(pwd)) score++;
    if (/[0-9]/.test(pwd) || /[^A-Za-z0-9]/.test(pwd)) score++;
    return score as 0 | 1 | 2 | 3 | 4;
  };

  const strength = calculateStrength(password);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters long');
      return;
    }

    setIsLoading(true);

    
    try {
      await new Promise(resolve => setTimeout(resolve, 1500));
      console.log('Password updated successfully');
      setShowSuccess(true);
      setTimeout(() => {
        router.push('/auth/login?reset=success');
      }, 3000);
    } catch {
      setError('An error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const isFormValid = password && confirmPassword && password.length >= 8;

  return (
    <AuthLayout showcaseContent={<WorldMapShowcase />}>
      <div className="space-y-8 md:space-y-10">
        <div className="space-y-2">
          <h1 className="text-[28px] md:text-[32px] leading-tight font-bold text-[#101828]">
            Create new password
          </h1>
          <p className="text-sm md:text-base text-[#667085] leading-relaxed">
            Create a new secure password for future access to your Zendvo account.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-1.5">
            <PasswordInput
              id="password"
              label="Enter new password"
              placeholder="••••••••••••••"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError(null);
              }}
              className="!border-[#D0D5DD]"
              required
              autoComplete="new-password"
            />
            <p className="text-[12px] text-[#667085] leading-normal px-1">
              Password must be at least 8 characters long and include an uppercase letter, a lowercase letter, a number, and a special character.
            </p>
            <PasswordStrengthIndicator strength={strength} />
          </div>

          <PasswordInput
            id="confirmPassword"
            label="Confirm Password"
            placeholder="••••••••••••••"
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value);
              setError(null);
            }}
            error={error || undefined}
            className="!border-[#D0D5DD]"
            required
            autoComplete="new-password"
          />

          <div className="pt-2">
            <Button
              type="submit"
              variant="primary"
              className="w-full bg-[#5D38D0]! hover:bg-[#4E2EB3]! rounded-lg! text-base! font-semibold! cursor-pointer py-3 transition-colors h-[48px]"
              isLoading={isLoading}
              disabled={!isFormValid || isLoading}
            >
              Create new password
            </Button>
          </div>
        </form>
      </div>

      {}
      {showSuccess && (
        <div className="fixed bottom-8 left-8 z-50 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="flex items-center gap-3 bg-[#ECFDF3] border border-[#D1FADF] rounded-lg px-4 py-3 shadow-sm">
            <div className="w-2 h-2 rounded-full bg-[#12B76A]" />
            <p className="text-sm font-medium text-[#027A48]">
              Password reset was successful.
            </p>
          </div>
        </div>
      )}
    </AuthLayout>
  );
};

export default ResetPasswordPage;
