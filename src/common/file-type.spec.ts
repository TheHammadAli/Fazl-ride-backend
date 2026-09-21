import { detectFileType } from './file-type.js';

describe('detectFileType', () => {
  it('detects jpeg, png, webp and pdf by their signatures', () => {
    expect(detectFileType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0]))?.ext).toBe(
      'jpg',
    );
    expect(
      detectFileType(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]),
      )?.ext,
    ).toBe('png');
    expect(detectFileType(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))?.ext).toBe(
      'webp',
    );
    expect(detectFileType(Buffer.from('%PDF-1.7 ...'))?.ext).toBe('pdf');
  });

  it('rejects anything else, whatever it claims to be', () => {
    expect(detectFileType(Buffer.from('<script>alert(1)</script>'))).toBeNull();
    expect(detectFileType(Buffer.from('MZ\x90\0'))).toBeNull();
    expect(detectFileType(Buffer.alloc(0))).toBeNull();
  });
});
