import Link from 'next/link';
import { Bird } from '../components/bird';

export const metadata = { title: 'Not found' };

export default function NotFound() {
  return (
    <div className="container section notfound">
      <Bird size={112} />
      <h1 className="page-title">Nothing at this address</h1>
      <p className="lede">There is no page here, or no run with that id.</p>
      <Link className="btn btn-yellow btn-lg" href="/">
        Back to the start
      </Link>
    </div>
  );
}
