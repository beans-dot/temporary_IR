'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { UserRole } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/store/useAuthStore';
import { Ticker } from './Ticker';

const NAV: Array<{ href: string; label: string; roles: UserRole[] }> = [
  { href: '/admin', label: '시스템관리', roles: ['admin'] },
  {
    href: '/update-history',
    label: '업데이트 이력',
    roles: ['admin', 'user'],
  },
  {
    href: '/profile',
    label: '회원정보관리',
    roles: ['admin', 'user'],
  },
];

export function Header() {
  const pathname = usePathname();
  const { user, hydrated, hydrate, logout } = useAuthStore();

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  if (pathname === '/login' || pathname === '/signup' || pathname === '/find-account') {
    return null;
  }

  const isHome = pathname === '/';
  const role = user?.role;
  const homeHref = '/';
  const visibleNav = role
    ? NAV.filter((item) => item.roles.includes(role))
    : [];

  const onLogout = async () => {
    await logout();
    window.location.assign('/login');
  };

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/95 backdrop-blur">
      <div className="flex h-16 min-w-0 items-center gap-2 px-3 sm:gap-4 sm:px-6">
        <Link
          href={homeHref}
          className="flex min-w-0 max-w-[70%] shrink items-center gap-4 sm:max-w-none sm:shrink-0 sm:gap-6"
        >
          <div className="relative h-[34px] w-[154px] shrink-0 sm:h-[39px] sm:w-[177px]">
            <Image
              src="/logo.png"
              alt="연성대학교"
              fill
              sizes="(max-width: 640px) 154px, 177px"
              style={{ objectFit: 'contain' }}
              priority
            />
          </div>
          <div className="relative h-[20px] w-[122px] min-w-0 shrink sm:h-[24px] sm:w-[145px] sm:shrink-0">
            <Image
              src="/ysu-ir-library-wordmark.png"
              alt="YSU IR Library"
              fill
              sizes="(max-width: 640px) 122px, 145px"
              style={{ objectFit: 'contain', objectPosition: 'left center' }}
              priority
            />
          </div>
        </Link>

        {hydrated && user && (
          <>
            {!isHome && (
              <div className="mx-1 flex min-w-0 flex-1 basis-0 justify-center overflow-hidden sm:mx-4">
                <div className="w-full min-w-0 max-w-2xl">
                  <Ticker />
                </div>
              </div>
            )}
            {isHome && <div className="min-w-0 flex-1" />}

            <nav className="relative z-10 flex shrink-0 items-center gap-0.5 sm:gap-1">
              {visibleNav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'rounded-md px-2 py-2 text-sm font-bold transition-colors hover:bg-accent sm:px-3',
                    pathname?.startsWith(item.href)
                      ? 'text-primary'
                      : 'text-muted-foreground',
                  )}
                >
                  {item.label}
                </Link>
              ))}
              <span className="mx-1 hidden text-sm font-bold text-blue-900 lg:inline">
                {user.name}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onLogout}
                className="gap-1 border border-gray-300 bg-transparent px-2 hover:bg-transparent sm:px-3"
              >
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">로그아웃</span>
              </Button>
            </nav>
          </>
        )}
      </div>
    </header>
  );
}
