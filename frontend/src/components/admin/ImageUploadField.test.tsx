import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ApiError } from '../../api/httpClient';
import { ImageUploadField } from './ImageUploadField';

jest.mock('../../api/uploads', () => ({
  ALLOWED_UPLOAD_CONTENT_TYPES: ['image/jpeg', 'image/png', 'image/webp'],
  requestPresignedUpload: jest.fn(),
  uploadToS3: jest.fn(),
}));

const uploadsApi = jest.requireMock('../../api/uploads') as {
  requestPresignedUpload: jest.Mock;
  uploadToS3: jest.Mock;
};

function makeFile(name: string, type: string, sizeBytes: number): File {
  const file = new File([new Uint8Array(sizeBytes)], name, { type });
  return file;
}

describe('ImageUploadField', () => {
  beforeEach(() => {
    uploadsApi.requestPresignedUpload.mockReset();
    uploadsApi.uploadToS3.mockReset();
    // jsdom does not implement the Blob URL APIs; the component only ever
    // uses them as opaque handles for `<img src>`, never resolves them.
    global.URL.createObjectURL = jest.fn(() => 'blob:mock-url');
    global.URL.revokeObjectURL = jest.fn();
  });

  it('rejects a disallowed image type before ever requesting a presigned URL', async () => {
    const onChange = jest.fn();
    render(<ImageUploadField productName="Trail Bottle" imageKeys={[]} onChange={onChange} />);

    const input = screen.getByLabelText(/product images/i);
    const gifFile = makeFile('photo.gif', 'image/gif', 1024);
    // `applyAccept: false` — the `accept` attribute is a UX hint for the
    // browser's file picker, not a security boundary, so this test also
    // exercises the component's own runtime content-type check rather than
    // relying on userEvent silently filtering the file out beforehand.
    await userEvent.upload(input, gifFile, { applyAccept: false });

    expect(await screen.findByText(/only jpeg, png, or webp/i)).toBeInTheDocument();
    expect(uploadsApi.requestPresignedUpload).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("surfaces the backend's rejection of an oversized image and does not attach a key", async () => {
    uploadsApi.requestPresignedUpload.mockRejectedValueOnce(
      new ApiError('contentLength must not exceed 5242880 bytes', 'VALIDATION_ERROR', 400),
    );
    const onChange = jest.fn();
    render(<ImageUploadField productName="Trail Bottle" imageKeys={[]} onChange={onChange} />);

    const input = screen.getByLabelText(/product images/i);
    const oversizedFile = makeFile('huge.png', 'image/png', 8 * 1024 * 1024);
    await userEvent.upload(input, oversizedFile);

    expect(await screen.findByText(/contentLength must not exceed/i)).toBeInTheDocument();
    expect(uploadsApi.uploadToS3).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('uploads a valid image, attaches the returned key, and shows a preview', async () => {
    uploadsApi.requestPresignedUpload.mockResolvedValueOnce({
      key: 'products/new-key.png',
      uploadUrl: 'https://s3.example.com/upload',
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      expiresInSeconds: 60,
    });
    uploadsApi.uploadToS3.mockResolvedValueOnce(undefined);
    const onChange = jest.fn();
    render(<ImageUploadField productName="Trail Bottle" imageKeys={[]} onChange={onChange} />);

    const input = screen.getByLabelText(/product images/i);
    const goodFile = makeFile('bottle.png', 'image/png', 2048);
    await userEvent.upload(input, goodFile);

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(['products/new-key.png']));
    expect(uploadsApi.requestPresignedUpload).toHaveBeenCalledWith({
      contentType: 'image/png',
      contentLength: 2048,
    });
    expect(uploadsApi.uploadToS3).toHaveBeenCalled();
  });

  it('lets an admin remove an already-attached image key', async () => {
    const onChange = jest.fn();
    render(
      <ImageUploadField
        productName="Trail Bottle"
        imageKeys={['products/existing.png']}
        onChange={onChange}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /remove/i }));

    expect(onChange).toHaveBeenCalledWith([]);
  });
});
