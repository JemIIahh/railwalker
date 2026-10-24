import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Icon } from '../../../components/icons';
import { Notice } from '../../../components/notice';
import { RunView } from '../../../components/run-view';
import { getData } from '../../../lib/data';
import { loadRun } from '../../../lib/load';

export const revalidate = 300;

/** No run is built ahead of time; each is built when first asked for, then kept for five minutes. */
export function generateStaticParams(): { id: string }[] {
  return [];
}

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return { title: `Run ${id.slice(0, 8)}` };
}

export default async function RunPage({ params }: Props) {
  const { id } = await params;
  const loaded = await loadRun(getData(), id);
  if (loaded.state === 'empty') notFound();
  return (
    <div className="container section-tight run-page">
      <Link className="back chip chip-plain" href="/explore">
        <Icon name="arrowRight" size={14} style={{ transform: 'rotate(180deg)' }} /> Explore
      </Link>
      {loaded.state === 'broken' ? <Notice loaded={loaded} what="run" /> : <RunView run={loaded.value} />}
    </div>
  );
}
