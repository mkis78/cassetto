import { describe, expect, test } from 'vitest'
import { parseMounts } from '../src/main/platform/volumes'

describe('parseMounts', () => {
  test('keeps removable and /mnt mounts of the user', () => {
    const sample = [
      '/dev/sda1 / ext4 rw 0 0',
      '/dev/sdb1 /media/marco/USB\\040KEY vfat rw 0 0',
      '/dev/sdc1 /run/media/marco/Backup ext4 rw 0 0',
      '/dev/sdd1 /mnt/data ext4 rw 0 0',
      '/dev/sde1 /media/other/X vfat rw 0 0',
      'tmpfs /run tmpfs rw 0 0'
    ].join('\n')
    expect(parseMounts(sample, 'marco')).toEqual([
      { name: 'USB KEY', path: '/media/marco/USB KEY' },
      { name: 'Backup', path: '/run/media/marco/Backup' },
      { name: 'data', path: '/mnt/data' }
    ])
  })
})
