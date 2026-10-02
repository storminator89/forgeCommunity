import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { motion } from '@/lib/motion';

function Draft() {
  const [value, setValue] = useState('');
  return <input aria-label="Entwurf" value={value} onChange={event => setValue(event.target.value)} />;
}
function Composer({ count }: { count: number }) {
  return <motion.div><span>{count}</span><Draft /></motion.div>;
}

it('keeps a typed draft and focus when its animated parent rerenders', () => {
  const { rerender } = render(<Composer count={0} />);
  const input = screen.getByRole('textbox', { name: 'Entwurf' });
  input.focus();
  fireEvent.change(input, { target: { value: 'Mein neuer Beitrag' } });
  rerender(<Composer count={1} />);
  expect(screen.getByRole('textbox', { name: 'Entwurf' })).toHaveValue('Mein neuer Beitrag');
  expect(screen.getByRole('textbox', { name: 'Entwurf' })).toHaveFocus();
});
