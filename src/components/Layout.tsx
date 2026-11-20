// OWNER: Agent E（含頂部導航列）
import { Outlet } from 'react-router-dom';
import NavBar from './NavBar';
import UpdateBanner from './UpdateBanner';

export default function Layout() {
  return (
    <>
      <UpdateBanner />
      <NavBar />
      <main>
        <Outlet />
      </main>
    </>
  );
}
