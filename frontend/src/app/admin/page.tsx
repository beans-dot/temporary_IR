'use client';

import { useState } from 'react';
import { AutoSaveToastHost } from '@/components/admin/AutoSaveToast';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { AdminNav, ADMIN_MENU_TITLES, type AdminMenuId } from '@/components/admin/AdminNav';
import { AlimiBatchManager } from '@/components/admin/AlimiBatchManager';
import { AnnualEventsManager } from '@/components/admin/AnnualEventsManager';
import { MemberActivityLog } from '@/components/admin/MemberActivityLog';
import { MemberManager } from '@/components/admin/MemberManager';
import { OrgManager } from '@/components/admin/OrgManager';
import { RawDataCorrection } from '@/components/admin/RawDataCorrection';
import { SignupApproval } from '@/components/admin/SignupApproval';
import { StrategicPlanManager } from '@/components/admin/StrategicPlanManager';
import { TreeBuilder } from '@/components/admin/TreeBuilder';
import { UploadCenter } from '@/components/admin/UploadCenter';

function AdminBody({ menu }: { menu: AdminMenuId }) {
  switch (menu) {
    case 'signup':
      return <SignupApproval />;
    case 'members':
      return <MemberManager />;
    case 'records':
      return <MemberActivityLog />;
    case 'tree':
      return <TreeBuilder />;
    case 'org':
      return <OrgManager />;
    case 'strategic-plan':
      return <StrategicPlanManager />;
    case 'alimi':
      return <AlimiBatchManager />;
    case 'upload':
      return <UploadCenter />;
    case 'correction':
      return <RawDataCorrection />;
    case 'annual':
      return <AnnualEventsManager />;
  }
}

export default function AdminPage() {
  const [menu, setMenu] = useState<AdminMenuId>('signup');

  return (
    <AuthGuard adminOnly>
      <div className="px-6 py-6">
        <h1 className="mb-4 text-2xl">시스템관리</h1>
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
          <AdminNav menu={menu} onSelect={setMenu} />
          <div className="min-w-0 flex-1">
            <div className="sr-only">{ADMIN_MENU_TITLES[menu]}</div>
            <AdminBody menu={menu} />
          </div>
        </div>
      </div>
      <AutoSaveToastHost />
    </AuthGuard>
  );
}
