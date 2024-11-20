'use client';

import { Metadata } from 'next';
import UserManagement from '@/components/admin/UserManagement';
import { getDictionary } from "@/i18n/getDictionary";
import { useParams } from "next/navigation";
import { useEffect, useState } from 'react';
import { LoadingSpinner } from "@/components/loading-spinner";

export default function UserManagementPage() {
  const params = useParams();
  const [dict, setDict] = useState<any>(null);
  const lang = params?.lang as string;

  useEffect(() => {
    const loadDictionary = async () => {
      const dictionary = await getDictionary(lang);
      setDict(dictionary);
    };
    loadDictionary();
  }, [lang]);

  if (!dict) return <LoadingSpinner />;

  return <UserManagement dict={dict} lang={lang} />;
}
