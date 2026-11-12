import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ResetPasswordPage, { RESET_SENT_MESSAGE } from './ResetPasswordPage';
import { useAuth, type AuthContextValue } from '../auth/AuthContext';

vi.mock('../auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../services/auth', () => ({
  authErrorMessage: vi.fn(() => '請求過於頻繁'),
  isUserCancelled: vi.fn(() => false),
}));

function setup(resetPassword: AuthContextValue['resetPassword']) {
  vi.mocked(useAuth).mockReturnValue({ resetPassword } as unknown as AuthContextValue);
  render(
    <MemoryRouter>
      <ResetPasswordPage />
    </MemoryRouter>,
  );
}

async function send(email: string) {
  const input = screen.getByLabelText('Email');
  expect(input).toHaveAttribute('autocomplete', 'email');
  await userEvent.type(input, email);
  await userEvent.click(screen.getByRole('button', { name: '寄送重設郵件' }));
}

describe('ResetPasswordPage', () => {
  it('成功時顯示統一訊息', async () => {
    const reset = vi.fn().mockResolvedValue(undefined);
    setup(reset);
    await send('a@b.com');
    expect(reset).toHaveBeenCalledWith('a@b.com');
    expect(await screen.findByText(RESET_SENT_MESSAGE)).toBeInTheDocument();
  });

  it('auth/user-not-found 也顯示同樣的成功訊息', async () => {
    setup(vi.fn().mockRejectedValue(Object.assign(new Error('x'), { code: 'auth/user-not-found' })));
    await send('nobody@b.com');
    expect(await screen.findByText(RESET_SENT_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('其他錯誤顯示錯誤訊息', async () => {
    setup(vi.fn().mockRejectedValue(Object.assign(new Error('x'), { code: 'auth/too-many-requests' })));
    await send('a@b.com');
    expect(await screen.findByRole('alert')).toHaveTextContent('請求過於頻繁');
    expect(screen.queryByText(RESET_SENT_MESSAGE)).not.toBeInTheDocument();
  });

  it('email 格式錯誤不呼叫 resetPassword', async () => {
    const reset = vi.fn();
    setup(reset);
    await send('bad');
    expect(screen.getByRole('alert')).toHaveTextContent('email 格式不正確');
    expect(reset).not.toHaveBeenCalled();
  });
});
