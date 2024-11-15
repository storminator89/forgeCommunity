'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

interface Certificate {
  id: string;
  userName: string;
  courseName: string;
  issuedAt: string;
}

interface VerificationResponse {
  valid: boolean;
  certificate?: Certificate;
  message?: string;
}

export default function VerifyCertificate() {
  const params = useParams();
  const [verificationResult, setVerificationResult] = useState<VerificationResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const verifyCertificate = async () => {
      try {
        const response = await fetch(`/api/verify-certificate/${params.certificateId}`);
        const data = await response.json();
        setVerificationResult(data);
      } catch (error) {
        setVerificationResult({
          valid: false,
          message: 'Error verifying certificate',
        });
      } finally {
        setLoading(false);
      }
    };

    verifyCertificate();
  }, [params.certificateId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-t-2 border-b-2 border-gray-900"></div>
      </div>
    );
  }

  if (!verificationResult) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-600">Error</h1>
          <p className="mt-2">Unable to verify certificate</p>
        </div>
      </div>
    );
  }

  if (!verificationResult.valid) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-600">Invalid Certificate</h1>
          <p className="mt-2">{verificationResult.message}</p>
        </div>
      </div>
    );
  }

  const certificate = verificationResult.certificate!;
  const issueDate = new Date(certificate.issuedAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-2xl w-full mx-4">
        <div className="bg-white rounded-lg shadow-lg p-8">
          <div className="text-center">
            <div className="mb-4">
              <svg
                className="mx-auto h-12 w-12 text-green-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <h1 className="text-3xl font-bold text-gray-900 mb-4">Valid Certificate</h1>
            <div className="border-t border-b border-gray-200 py-4 my-4">
              <p className="text-lg text-gray-600">
                This certificate was issued to
                <span className="font-semibold text-gray-900"> {certificate.userName}</span>
              </p>
              <p className="text-lg text-gray-600 mt-2">
                for completing the course
                <span className="font-semibold text-gray-900"> {certificate.courseName}</span>
              </p>
            </div>
            <div className="text-sm text-gray-500">
              <p>Certificate ID: {certificate.id}</p>
              <p className="mt-1">Issue Date: {issueDate}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
