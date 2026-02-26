import {
  VK_GROUP1_TOKEN,
  VK_GROUP2_TOKEN,
  VK_USER_TOKEN,
  VK_API_VERSION,
} from './config';

export async function callVK(
  method: string,
  params: Record<string, string | number | undefined> = {},
  useGroup2 = false,
  useUserToken = false,
): Promise<any> {
  let token: string;

  if (useUserToken && VK_USER_TOKEN) {
    token = VK_USER_TOKEN;
  } else {
    token = useGroup2 ? VK_GROUP2_TOKEN : VK_GROUP1_TOKEN;
  }

  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) body.set(k, String(v));
  }
  body.set('access_token', token);
  body.set('v', VK_API_VERSION);

  const res = await fetch(`https://api.vk.com/method/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const data = await res.json();
  if (data.error) throw new Error(`VK API Error: ${data.error.error_msg}`);
  return data.response;
}

export async function sendMessage(
  peerId: number,
  message: string,
  extra: Record<string, string | number | undefined> = {},
): Promise<number | null> {
  try {
    const response = await callVK('messages.send', {
      peer_id: peerId,
      message,
      random_id: Math.floor(Math.random() * 1_000_000_000),
      ...extra,
    });
    return response as number;
  } catch (err: any) {
    console.error('[Bot] Ошибка отправки сообщения:', err.message);
    return null;
  }
}

export async function getUser(userId: number) {
  try {
    const users = await callVK('users.get', { user_ids: userId });
    return users[0] as { id: number; first_name: string; last_name: string };
  } catch {
    return null;
  }
}

export async function reuploadPhotoToGroup(
  photoAttachment: any,
  groupId: string,
  useGroup2 = false,
): Promise<string | null> {
  try {
    const sizes: any[] = photoAttachment.sizes || [];
    if (!sizes.length) return null;

    sizes.sort((a: any, b: any) => b.width * b.height - a.width * a.height);
    const photoUrl = sizes[0].url;

    const photoRes = await fetch(photoUrl);
    const photoBuffer = await photoRes.arrayBuffer();

    const uploadServer = await callVK(
      'photos.getWallUploadServer',
      { group_id: groupId },
      useGroup2,
    );

    const formData = new FormData();
    formData.append(
      'photo',
      new Blob([photoBuffer], { type: 'image/jpeg' }),
      'photo.jpg',
    );

    const uploadRes = await fetch(uploadServer.upload_url, {
      method: 'POST',
      body: formData,
    });
    const uploadResult = await uploadRes.json();

    const saveResult = await callVK(
      'photos.saveWallPhoto',
      {
        group_id: groupId,
        photo: uploadResult.photo,
        server: uploadResult.server,
        hash: uploadResult.hash,
      },
      useGroup2,
    );

    if (saveResult?.[0]) {
      const p = saveResult[0];
      return `photo${p.owner_id}_${p.id}`;
    }
    return null;
  } catch (err: any) {
    console.error('[Bot] Ошибка reupload фото:', err.message);
    return null;
  }
}
