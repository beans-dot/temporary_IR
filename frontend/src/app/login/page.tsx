'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { homePathForRole, useAuthStore } from '@/store/useAuthStore';

export default function LoginPage() {
  const router = useRouter();
  const { user, hydrated, hydrate, login } = useAuthStore();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [quickTarget, setQuickTarget] = useState<'admin' | 'user' | null>(null);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (hydrated && user) {
      router.replace(homePathForRole(user.role));
    }
  }, [hydrated, user, router]);

  const quickLogin = async (
    loginId: string,
    loginPassword: string,
    target: 'admin' | 'user',
  ) => {
    setError(null);
    setSubmitting(true);
    setQuickTarget(target);
    const result = await login(loginId, loginPassword);
    setSubmitting(false);
    setQuickTarget(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.replace(homePathForRole(result.user.role));
  };

  return (
    <div className="flex min-h-full items-center justify-center px-6 py-12">
      <Card className="w-full max-w-lg">
        <CardHeader className="space-y-4 text-center">
          <div className="relative mx-auto h-12 w-[8.25rem] sm:h-14 sm:w-[9.6rem]">
            <Image
              src="/logo.png"
              alt="연성대학교"
              fill
              sizes="(max-width: 640px) 132px, 154px"
              style={{ objectFit: 'contain' }}
              priority
            />
          </div>
          <div>
            <CardTitle className="text-2xl">테스트 로그인</CardTitle>
            <CardDescription className="mt-2">
              YSU IR Library
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-950">
            <p>
              시연을 위한 더미 데이터 버전입니다. 아래 테스트 로그인을 클릭하시어 시연을 해보시기 바랍니다.
            </p>
            <p className="mt-3">
              실제 운영 서버의 경우 연성대학교 재직 교직원 중 허가받은 인원만 접근이 가능합니다.
            </p>
          </div>
          {error && (
            <p className="whitespace-pre-line text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => quickLogin('admin', '21672167', 'admin')}
              disabled={submitting}
              className="h-auto flex-col items-start rounded-lg px-4 py-4 text-left"
            >
              <span className="text-sm font-bold">관리자 테스트 로그인</span>
              <span className="mt-1 text-xs text-muted-foreground">
                {quickTarget === 'admin' ? '로그인 중…' : '관리자 기능 체험'}
              </span>
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => quickLogin('test_user_1', 'test1234', 'user')}
              disabled={submitting}
              className="h-auto flex-col items-start rounded-lg px-4 py-4 text-left"
            >
              <span className="text-sm font-bold">사용자 테스트 로그인</span>
              <span className="mt-1 text-xs text-muted-foreground">
                {quickTarget === 'user' ? '로그인 중…' : '조회·분석 기능 체험'}
              </span>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
